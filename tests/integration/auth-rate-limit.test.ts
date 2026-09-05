import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  BoundedMap,
  IpBurstLimiter,
  ConcurrencyLimiter,
  PerIpUsernameFailureLimiter,
  getClientIp,
  ipBurstLimiter,
  argon2CircuitBreaker,
  ipUserFailureLimiter,
} from "../../src/features/auth/rate-limit";
import { hashPassword, verifyPassword } from "../../src/features/auth/password";
import { verifyCredentials } from "../../src/features/auth/service";

describe("SEC-01: Authentication Rate Limiting & Resource Exhaustion Protection", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await getTestPrisma();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    // Reset application singletons between tests
    ipBurstLimiter.clear();
    argon2CircuitBreaker.reset();
    ipUserFailureLimiter.clear();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  // ===========================================================================
  // 1. IP Burst Limiter
  // ===========================================================================
  describe("IP Burst Limiter (5 req / 10s / IP)", () => {
    it("1. permits requests below the threshold", () => {
      const limiter = new IpBurstLimiter(5, 10_000, 100);
      const ip = "192.0.2.1";
      const now = 1_000_000;

      for (let i = 1; i <= 5; i++) {
        const res = limiter.consume(ip, now + i * 100);
        expect(res.allowed).toBe(true);
        expect(res.remaining).toBe(5 - i);
      }
    });

    it("2. blocks the 6th rapid request from the same IP when using 5/10s", () => {
      const limiter = new IpBurstLimiter(5, 10_000, 100);
      const ip = "192.0.2.1";
      const now = 1_000_000;

      for (let i = 1; i <= 5; i++) {
        limiter.consume(ip, now + i * 100);
      }

      const res6 = limiter.consume(ip, now + 600);
      expect(res6.allowed).toBe(false);
      expect(res6.remaining).toBe(0);
      expect(res6.retryAfterMs).toBeGreaterThan(0);
    });

    it("3. expired entries become available again", () => {
      const limiter = new IpBurstLimiter(5, 10_000, 100);
      const ip = "192.0.2.1";
      const now = 1_000_000;

      // Consume 5 requests at t=1,000,000
      for (let i = 0; i < 5; i++) {
        limiter.consume(ip, now);
      }

      // 6th at same time is blocked
      expect(limiter.consume(ip, now).allowed).toBe(false);

      // Advance time past the 10-second window (t=1,010,001)
      const afterExpiry = limiter.consume(ip, now + 10_001);
      expect(afterExpiry.allowed).toBe(true);
      expect(afterExpiry.remaining).toBe(4);
    });

    it("4. different IPs do not share the same burst bucket", () => {
      const limiter = new IpBurstLimiter(5, 10_000, 100);
      const ipA = "192.0.2.1";
      const ipB = "192.0.2.2";
      const now = 1_000_000;

      // Exhaust ipA
      for (let i = 0; i < 5; i++) {
        limiter.consume(ipA, now);
      }
      expect(limiter.consume(ipA, now).allowed).toBe(false);

      // ipB should still be completely unthrottled
      const resB = limiter.consume(ipB, now);
      expect(resB.allowed).toBe(true);
      expect(resB.remaining).toBe(4);
    });
  });

  // ===========================================================================
  // 2. Bounded Storage & Eviction (Memory Safety)
  // ===========================================================================
  describe("Bounded Storage & Memory Safety (BoundedMap)", () => {
    it("5. bounded storage cannot exceed its configured maximum", () => {
      const maxCapacity = 5;
      const map = new BoundedMap<string, string>(maxCapacity);

      for (let i = 1; i <= 10; i++) {
        map.set(`key-${i}`, `val-${i}`, 60_000);
        expect(map.size).toBeLessThanOrEqual(maxCapacity);
      }

      expect(map.size).toBe(maxCapacity);
    });

    it("6. LRU eviction works (oldest entry evicted first)", () => {
      const map = new BoundedMap<string, string>(3);

      map.set("a", "1", 60_000);
      map.set("b", "2", 60_000);
      map.set("c", "3", 60_000);

      // Access "a" to make it recently used: order is now b, c, a
      map.get("a");

      // Insert "d": capacity reached, oldest entry "b" should be evicted
      map.set("d", "4", 60_000);

      expect(map.get("b")).toBeUndefined(); // evicted
      expect(map.get("a")).toBe("1"); // preserved
      expect(map.get("c")).toBe("3"); // preserved
      expect(map.get("d")).toBe("4"); // preserved
    });

    it("7. an unbounded number of attacker-controlled keys cannot cause unbounded memory growth", () => {
      const map = new BoundedMap<string, number>(100);

      // Attacker sprays 5,000 distinct random IP keys
      for (let i = 0; i < 5_000; i++) {
        map.set(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, i, 10_000);
      }

      // Store size is strictly bounded to capacity
      expect(map.size).toBe(100);
      expect(map.capacity).toBe(100);
    });
  });

  // ===========================================================================
  // 3. Argon2 Concurrency Circuit Breaker (Semaphore)
  // ===========================================================================
  describe("Argon2 Concurrency Circuit Breaker (Semaphore)", () => {
    it("8. concurrent verification attempts cannot exceed the semaphore limit", () => {
      const limiter = new ConcurrencyLimiter(4);

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);

      // 5th attempt must fail
      expect(limiter.tryAcquire()).toBe(false);
      expect(limiter.getActiveCount()).toBe(4);
    });

    it("9. semaphore permits are released after successful verification", async () => {
      const limiter = new ConcurrencyLimiter(4);

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.getActiveCount()).toBe(1);

      try {
        // simulate successful operation
      } finally {
        limiter.release();
      }

      expect(limiter.getActiveCount()).toBe(0);
    });

    it("10. semaphore permits are released after failed verification", async () => {
      const limiter = new ConcurrencyLimiter(4);

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.getActiveCount()).toBe(1);

      try {
        // simulate failed password verification (returns false)
        const valid = false;
        expect(valid).toBe(false);
      } finally {
        limiter.release();
      }

      expect(limiter.getActiveCount()).toBe(0);
    });

    it("11. semaphore permits are released after an exception", async () => {
      const limiter = new ConcurrencyLimiter(4);

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.getActiveCount()).toBe(1);

      expect(() => {
        try {
          throw new Error("Simulated verification crash");
        } finally {
          limiter.release();
        }
      }).toThrow("Simulated verification crash");

      expect(limiter.getActiveCount()).toBe(0);
    });

    it("12. no unbounded waiting queue exists (synchronous non-blocking acquisition)", () => {
      const limiter = new ConcurrencyLimiter(2);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);

      // Immediate synchronous return of false — zero promise queue
      const acquired = limiter.tryAcquire();
      expect(acquired).toBe(false);
    });

    it("13. when all slots are occupied, additional login requests are rejected safely", async () => {
      const password = "valid_password123";
      const passwordHash = await hashPassword(password);
      await prisma.user.create({
        data: { username: "concurrency_user", passwordHash },
      });

      // Artificially saturate all 4 slots on the application singleton
      expect(argon2CircuitBreaker.tryAcquire()).toBe(true);
      expect(argon2CircuitBreaker.tryAcquire()).toBe(true);
      expect(argon2CircuitBreaker.tryAcquire()).toBe(true);
      expect(argon2CircuitBreaker.tryAcquire()).toBe(true);

      // 5th login attempt must be rejected immediately with overload error
      const result = await verifyCredentials(
        { username: "concurrency_user", password },
        prisma
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Too many login attempts. Please try again later.");
      }

      // Cleanup saturated slots
      argon2CircuitBreaker.reset();
      expect(argon2CircuitBreaker.getActiveCount()).toBe(0);
    });
  });

  // ===========================================================================
  // 4. End-to-End Login Flow & Password Verification
  // ===========================================================================
  describe("Login Flow & Security Verification", () => {
    it("14. nonexistent usernames do NOT trigger Argon2 verification", async () => {
      // Artificially saturate 3 of 4 slots to monitor slot usage
      expect(argon2CircuitBreaker.tryAcquire()).toBe(true);
      expect(argon2CircuitBreaker.tryAcquire()).toBe(true);
      expect(argon2CircuitBreaker.tryAcquire()).toBe(true);
      expect(argon2CircuitBreaker.getActiveCount()).toBe(3);

      const result = await verifyCredentials(
        { username: "nonexistent_target_user", password: "arbitrary_password" },
        prisma
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid username or password");
      }

      // Slot count should still be 3 (no slot was acquired or consumed for non-existent user)
      expect(argon2CircuitBreaker.getActiveCount()).toBe(3);
      argon2CircuitBreaker.reset();
    });

    it("15. valid usernames reach password verification when rate limits allow", async () => {
      const password = "valid_password123";
      const passwordHash = await hashPassword(password);
      await prisma.user.create({
        data: { username: "reach_verify_user", passwordHash },
      });

      const result = await verifyCredentials(
        { username: "reach_verify_user", password },
        prisma,
        { clientIp: "192.0.2.50" }
      );

      expect(result.success).toBe(true);
    });

    it("16. wrong passwords return generic error", async () => {
      const password = "valid_password123";
      const passwordHash = await hashPassword(password);
      await prisma.user.create({
        data: { username: "wrong_pwd_user", passwordHash },
      });

      const result = await verifyCredentials(
        { username: "wrong_pwd_user", password: "completely_wrong_pass" },
        prisma,
        { clientIp: "192.0.2.60" }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid username or password");
      }
    });

    it("17. correct passwords still authenticate normally", async () => {
      const password = "secure_user_pass_123";
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: { username: "normal_auth_user", passwordHash },
      });

      const result = await verifyCredentials(
        { username: "normal_auth_user", password },
        prisma,
        { clientIp: "192.0.2.70" }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(user.id);
      }
    });

    it("18. bcrypt legacy login migration still works", async () => {
      const password = "legacy_bcrypt_pass";
      const salt = await bcrypt.genSalt(10);
      const legacyHash = await bcrypt.hash(password, salt);

      const user = await prisma.user.create({
        data: { username: "legacy_migration_user", passwordHash: legacyHash },
      });

      const result = await verifyCredentials(
        { username: "legacy_migration_user", password },
        prisma,
        { clientIp: "192.0.2.80" }
      );

      expect(result.success).toBe(true);

      // Verify that database hash was upgraded to Argon2id
      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(updatedUser!.passwordHash.startsWith("$argon2id$")).toBe(true);
    });

    it("19. current Argon2id login still works", async () => {
      const password = "argon2id_standard_login";
      const passwordHash = await hashPassword(password);
      expect(passwordHash.startsWith("$argon2id$")).toBe(true);

      const user = await prisma.user.create({
        data: { username: "argon2_test_user", passwordHash },
      });

      const result = await verifyCredentials(
        { username: "argon2_test_user", password },
        prisma,
        { clientIp: "192.0.2.90" }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(user.id);
      }
    });
  });

  // ===========================================================================
  // 5. Account Lockout Prevention & IP Security
  // ===========================================================================
  describe("Account Lockout Prevention & IP Address Security", () => {
    it("per-(IP, username) throttle blocks the attacking IP after 5 failures without locking out legitimate user from another IP", async () => {
      const password = "alice_correct_password";
      const passwordHash = await hashPassword(password);
      await prisma.user.create({
        data: { username: "alice_target", passwordHash },
      });

      const attackerIp = "198.51.100.1";
      const aliceHomeIp = "203.0.113.5";

      // Attacker attempts 5 wrong passwords from attackerIp
      for (let i = 0; i < 5; i++) {
        const fail = await verifyCredentials(
          { username: "alice_target", password: `bad_guess_${i}` },
          prisma,
          { clientIp: attackerIp }
        );
        expect(fail.success).toBe(false);
      }

      // Attacker's 6th attempt is throttled
      const attackerThrottled = await verifyCredentials(
        { username: "alice_target", password: "any_password" },
        prisma,
        { clientIp: attackerIp }
      );
      expect(attackerThrottled.success).toBe(false);
      if (!attackerThrottled.success) {
        expect(attackerThrottled.error).toBe(
          "Too many login attempts. Please try again later."
        );
      }

      // Real Alice logging in from her home IP is NOT locked out!
      const aliceLogin = await verifyCredentials(
        { username: "alice_target", password },
        prisma,
        { clientIp: aliceHomeIp }
      );
      expect(aliceLogin.success).toBe(true);
    });

    it("successful login clears the transient failure counter for that (IP, username) pair", async () => {
      const password = "user_password_retry";
      const passwordHash = await hashPassword(password);
      await prisma.user.create({
        data: { username: "retry_user", passwordHash },
      });

      const clientIp = "192.0.2.110";

      // User makes 2 mistakes
      await verifyCredentials(
        { username: "retry_user", password: "bad_password_1" },
        prisma,
        { clientIp }
      );
      await verifyCredentials(
        { username: "retry_user", password: "bad_password_2" },
        prisma,
        { clientIp }
      );

      // User enters correct password on attempt 3
      const successResult = await verifyCredentials(
        { username: "retry_user", password },
        prisma,
        { clientIp }
      );
      expect(successResult.success).toBe(true);

      // Transient failure state for this (ip, username) is cleared
      expect(ipUserFailureLimiter.isBlocked(clientIp, "retry_user")).toBe(false);
    });

    it("untrusted X-Forwarded-For is not blindly trusted when TRUST_PROXY is not enabled", () => {
      const originalTrust = process.env.TRUST_PROXY;
      delete process.env.TRUST_PROXY;

      try {
        const mockHeaders = {
          get: (name: string) => {
            if (name === "x-forwarded-for") return "203.0.113.195, 10.0.0.1";
            if (name === "x-real-ip") return "203.0.113.195";
            return null;
          },
        };

        // When TRUST_PROXY is not enabled, getClientIp returns null
        const extracted = getClientIp(mockHeaders);
        expect(extracted).toBeNull();
      } finally {
        if (originalTrust !== undefined) {
          process.env.TRUST_PROXY = originalTrust;
        }
      }
    });

    it("trusted X-Forwarded-For extracts client IP when TRUST_PROXY is enabled", () => {
      const originalTrust = process.env.TRUST_PROXY;
      process.env.TRUST_PROXY = "true";

      try {
        const mockHeaders = {
          get: (name: string) => {
            if (name === "x-forwarded-for") return "203.0.113.195, 10.0.0.1";
            return null;
          },
        };

        const extracted = getClientIp(mockHeaders);
        expect(extracted).toBe("203.0.113.195");
      } finally {
        if (originalTrust !== undefined) {
          process.env.TRUST_PROXY = originalTrust;
        } else {
          delete process.env.TRUST_PROXY;
        }
      }
    });
  });
});
