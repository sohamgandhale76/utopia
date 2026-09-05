import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import argon2 from "argon2";
import bcrypt from "bcryptjs";

// Import auth modules directly (not the Server Actions, which require Next.js runtime)
import { usernameSchema, passwordSchema, registerSchema } from "../../src/features/auth/validation";
import { hashPassword, verifyPassword, needsRehash, ARGON2_OPTIONS } from "../../src/features/auth/password";
import { generateSessionToken, hashSessionToken } from "../../src/features/auth/crypto";
import { registerUser, verifyCredentials, validateSessionToken } from "../../src/features/auth/service";

describe("Stage 2: Authentication & Session Tests", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await getTestPrisma();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  // ===========================================================================
  // Username validation
  // ===========================================================================
  describe("Username validation", () => {
    it("rejects usernames shorter than 3 characters", () => {
      expect(usernameSchema.safeParse("ab").success).toBe(false);
    });

    it("rejects usernames longer than 24 characters", () => {
      expect(usernameSchema.safeParse("a".repeat(25)).success).toBe(false);
    });

    it("rejects uppercase letters", () => {
      expect(usernameSchema.safeParse("UserName").success).toBe(false);
    });

    it("rejects spaces", () => {
      expect(usernameSchema.safeParse("user name").success).toBe(false);
    });

    it("rejects special characters (hyphens, dots, etc.)", () => {
      expect(usernameSchema.safeParse("user-name").success).toBe(false);
      expect(usernameSchema.safeParse("user.name").success).toBe(false);
      expect(usernameSchema.safeParse("user@name").success).toBe(false);
    });

    it("accepts valid lowercase usernames", () => {
      expect(usernameSchema.safeParse("abc").success).toBe(true);
      expect(usernameSchema.safeParse("test_user_123").success).toBe(true);
      expect(usernameSchema.safeParse("a".repeat(24)).success).toBe(true);
    });
  });

  // ===========================================================================
  // Password validation
  // ===========================================================================
  describe("Password validation", () => {
    it("rejects passwords shorter than 12 characters", () => {
      expect(passwordSchema.safeParse("short12345!").success).toBe(false);
    });

    it("rejects passwords exceeding 64 UTF-8 bytes", () => {
      // Each emoji is 4 bytes, 17 emojis = 68 bytes
      const longUtf8 = "🔐".repeat(17);
      expect(passwordSchema.safeParse(longUtf8).success).toBe(false);
    });

    it("accepts valid passwords within byte limits", () => {
      expect(passwordSchema.safeParse("validpassword1").success).toBe(true);
      expect(passwordSchema.safeParse("a".repeat(64)).success).toBe(true);
    });
  });

  // ===========================================================================
  // Registration schema (combined)
  // ===========================================================================
  describe("Registration schema validation", () => {
    it("rejects invalid username + valid password", () => {
      const result = registerSchema.safeParse({
        username: "AB",
        password: "validpassword1",
      });
      expect(result.success).toBe(false);
    });

    it("rejects valid username + invalid password", () => {
      const result = registerSchema.safeParse({
        username: "valid_user",
        password: "short",
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid username + valid password", () => {
      const result = registerSchema.safeParse({
        username: "valid_user",
        password: "validpassword1",
      });
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Password hashing (Argon2id)
  // ===========================================================================
  describe("Password hashing (Argon2id)", () => {
    it("produces an Argon2id hash in standard PHC encoded format, never stores plaintext", async () => {
      const password = "my_secure_password_123";
      const hash = await hashPassword(password);

      expect(hash).not.toBe(password);
      expect(hash.startsWith("$argon2id$")).toBe(true);
      expect(hash).toContain("v=19");
      expect(hash).toContain("m=65536");
      expect(hash).toContain("t=3");
      expect(hash).toContain("p=4");
    });

    it("verifies a correct password against its hash", async () => {
      const password = "correct_horse_battery";
      const hash = await hashPassword(password);

      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it("rejects an incorrect password against a hash", async () => {
      const password = "correct_horse_battery";
      const hash = await hashPassword(password);

      expect(await verifyPassword("wrong_password_here", hash)).toBe(false);
    });

    it("generates unique salts so identical passwords produce different hashes", async () => {
      const password = "same_password_twice";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
      expect(await verifyPassword(password, hash1)).toBe(true);
      expect(await verifyPassword(password, hash2)).toBe(true);
    });

    it("correctly hashes and verifies multi-byte Unicode passwords", async () => {
      const unicodePassword = "пароль_на_русском_123";
      const hash = await hashPassword(unicodePassword);

      expect(hash.startsWith("$argon2id$")).toBe(true);
      expect(await verifyPassword(unicodePassword, hash)).toBe(true);
      expect(await verifyPassword("пароль_на_русском_456", hash)).toBe(false);
    });

    it("correctly hashes and verifies emoji-containing passwords", async () => {
      const emojiPassword = "secure🔐password🚀2026";
      const hash = await hashPassword(emojiPassword);

      expect(hash.startsWith("$argon2id$")).toBe(true);
      expect(await verifyPassword(emojiPassword, hash)).toBe(true);
      expect(await verifyPassword("secure🔓password🚀2026", hash)).toBe(false);
    });

    it("correctly hashes and verifies password at the 64 UTF-8 byte limit", async () => {
      const boundaryPassword = "a".repeat(64);
      expect(new TextEncoder().encode(boundaryPassword).length).toBe(64);

      const hash = await hashPassword(boundaryPassword);
      expect(hash.startsWith("$argon2id$")).toBe(true);
      expect(await verifyPassword(boundaryPassword, hash)).toBe(true);
    });

    it("fails safely and does not throw on malformed or corrupted hashes", async () => {
      const password = "valid_test_password";

      // Non-hash string
      expect(await verifyPassword(password, "not_a_valid_hash")).toBe(false);

      // Unknown algorithm prefix
      expect(await verifyPassword(password, "$md5$1234567890")).toBe(false);

      // Corrupted Argon2id hash structure
      expect(await verifyPassword(password, "$argon2id$v=19$corrupted_hash")).toBe(false);

      // Empty string
      expect(await verifyPassword(password, "")).toBe(false);

      // Non-string inputs
      expect(await verifyPassword(password, null as any)).toBe(false);
      expect(await verifyPassword(password, undefined as any)).toBe(false);
    });
  });

  // ===========================================================================
  // Legacy bcrypt support & Login-time migration
  // ===========================================================================
  describe("Legacy bcrypt support & Migration", () => {
    it("successfully verifies legacy bcrypt $2a$ and $2b$ hashes", async () => {
      const password = "legacy_bcrypt_pass";
      const bcryptHash = await bcrypt.hash(password, 10);
      expect(bcryptHash.startsWith("$2a$") || bcryptHash.startsWith("$2b$")).toBe(true);

      // Correct password verifies
      expect(await verifyPassword(password, bcryptHash)).toBe(true);
      // Wrong password fails
      expect(await verifyPassword("wrong_password", bcryptHash)).toBe(false);
    });

    it("needsRehash correctly distinguishes legacy bcrypt, current Argon2id, and outdated Argon2id", async () => {
      const password = "rehash_check_pass";

      // 1. Legacy bcrypt hash must need rehash
      const bcryptHash = await bcrypt.hash(password, 10);
      expect(needsRehash(bcryptHash)).toBe(true);

      // 2. Current Argon2id hash must NOT need rehash
      const currentHash = await hashPassword(password);
      expect(needsRehash(currentHash)).toBe(false);

      // 3. Outdated Argon2id hash (different parameters) must need rehash
      const outdatedHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      expect(needsRehash(outdatedHash)).toBe(true);

      // 4. Malformed/unknown hash safely returns false (no rehash)
      expect(needsRehash("unknown_format")).toBe(false);
    });

    it("migrates a legacy bcrypt password to Argon2id on successful login", async () => {
      const password = "migration_user_password";
      const legacyBcryptHash = await bcrypt.hash(password, 10);

      // Create user with legacy bcrypt hash in DB
      const user = await prisma.user.create({
        data: {
          username: "legacy_user",
          passwordHash: legacyBcryptHash,
        },
      });

      expect(user.passwordHash.startsWith("$2a$") || user.passwordHash.startsWith("$2b$")).toBe(true);

      // Authenticate via verifyCredentials
      const loginResult = await verifyCredentials(
        { username: "legacy_user", password },
        prisma
      );

      expect(loginResult.success).toBe(true);

      // Fetch user from DB and verify hash was upgraded to Argon2id
      const updatedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(updatedUser.passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(updatedUser.passwordHash).toContain("m=65536");
      expect(updatedUser.passwordHash).toContain("t=3");
      expect(updatedUser.passwordHash).toContain("p=4");
      expect(needsRehash(updatedUser.passwordHash)).toBe(false);

      // Newly stored Argon2id hash verifies with original password
      expect(await verifyPassword(password, updatedUser.passwordHash)).toBe(true);
    });

    it("does NOT migrate or alter legacy bcrypt hash if login fails with wrong password", async () => {
      const password = "real_legacy_password";
      const legacyBcryptHash = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          username: "unauth_legacy_user",
          passwordHash: legacyBcryptHash,
        },
      });

      // Failed login attempt
      const loginResult = await verifyCredentials(
        { username: "unauth_legacy_user", password: "wrong_password_attempt" },
        prisma
      );

      expect(loginResult.success).toBe(false);

      // Confirm DB record was not modified
      const unmutatedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(unmutatedUser.passwordHash).toBe(legacyBcryptHash);
    });

    it("does NOT rehash current Argon2id password unnecessarily on login", async () => {
      const password = "current_argon_password";
      const initialHash = await hashPassword(password);

      const user = await prisma.user.create({
        data: {
          username: "argon_user",
          passwordHash: initialHash,
        },
      });

      const loginResult = await verifyCredentials(
        { username: "argon_user", password },
        prisma
      );

      expect(loginResult.success).toBe(true);

      const userAfterLogin = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      // Stored hash should be unchanged
      expect(userAfterLogin.passwordHash).toBe(initialHash);
    });

    it("migrates outdated Argon2id hash to current configuration on successful login", async () => {
      const password = "outdated_argon_password";
      const outdatedHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });

      const user = await prisma.user.create({
        data: {
          username: "outdated_user",
          passwordHash: outdatedHash,
        },
      });

      expect(needsRehash(user.passwordHash)).toBe(true);

      const loginResult = await verifyCredentials(
        { username: "outdated_user", password },
        prisma
      );

      expect(loginResult.success).toBe(true);

      const updatedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(updatedUser.passwordHash).not.toBe(outdatedHash);
      expect(updatedUser.passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(updatedUser.passwordHash).toContain("m=65536");
      expect(updatedUser.passwordHash).toContain("t=3");
      expect(updatedUser.passwordHash).toContain("p=4");
      expect(needsRehash(updatedUser.passwordHash)).toBe(false);
      expect(await verifyPassword(password, updatedUser.passwordHash)).toBe(true);
    });
  });

  // ===========================================================================
  // Session token generation and hashing
  // ===========================================================================
  describe("Session token management", () => {
    it("generates a 256-bit (64 hex character) random token", () => {
      const token = generateSessionToken();
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it("generates unique tokens on each call", () => {
      const t1 = generateSessionToken();
      const t2 = generateSessionToken();
      expect(t1).not.toBe(t2);
    });

    it("produces a SHA-256 hex hash of the token", () => {
      const token = "a".repeat(64);
      const hash = hashSessionToken(token);
      const expected = createHash("sha256").update(token).digest("hex");
      expect(hash).toBe(expected);
      expect(hash).toHaveLength(64);
    });
  });

  // ===========================================================================
  // Registration blocked when ALLOW_PUBLIC_REGISTRATION=false
  // ===========================================================================
  describe("ALLOW_PUBLIC_REGISTRATION gate", () => {
    it("prevents account creation when ALLOW_PUBLIC_REGISTRATION is not 'true'", async () => {
      const originalValue = process.env.ALLOW_PUBLIC_REGISTRATION;
      process.env.ALLOW_PUBLIC_REGISTRATION = "false";

      try {
        const result = await registerUser({ username: "gate_user", password: "valid_password123" }, prisma);
        expect(result.success).toBe(false);
        expect(result.success === false && result.error).toMatch(/disabled/i);

        // Verify no user was created
        const userCount = await prisma.user.count({ where: { username: "gate_user" } });
        expect(userCount).toBe(0);
      } finally {
        process.env.ALLOW_PUBLIC_REGISTRATION = originalValue;
      }
    });
  });

  // ===========================================================================
  // Database-level registration (direct, bypassing Server Action runtime)
  // ===========================================================================
  describe("User creation in database", () => {
    it("stores an Argon2id hash, never plaintext password", async () => {
      const password = "test_password_secure";
      const passwordHash = await hashPassword(password);

      const user = await prisma.user.create({
        data: {
          username: "test_user_db",
          passwordHash,
        },
      });

      expect(user.passwordHash).not.toBe(password);
      expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(await verifyPassword(password, user.passwordHash)).toBe(true);
    });

    it("rejects duplicate usernames at the database level", async () => {
      const passwordHash = await hashPassword("secure_password_1");

      await prisma.user.create({
        data: { username: "unique_user", passwordHash },
      });

      await expect(
        prisma.user.create({
          data: { username: "unique_user", passwordHash },
        })
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Session creation in database
  // ===========================================================================
  describe("Session database records", () => {
    it("stores only the SHA-256 hash, not the raw token", async () => {
      const passwordHash = await hashPassword("session_test_pass");
      const user = await prisma.user.create({
        data: { username: "session_user", passwordHash },
      });

      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const session = await prisma.session.create({
        data: {
          userId: user.id,
          sessionTokenHash: tokenHash,
          expiresAt,
        },
      });

      // The stored hash must match the SHA-256 of the raw token
      expect(session.sessionTokenHash).toBe(tokenHash);
      // The stored value must NOT be the raw token
      expect(session.sessionTokenHash).not.toBe(rawToken);
      // Verify independently
      const expectedHash = createHash("sha256").update(rawToken).digest("hex");
      expect(session.sessionTokenHash).toBe(expectedHash);
    });

    it("can look up a session by its token hash", async () => {
      const passwordHash = await hashPassword("lookup_test_pass");
      const user = await prisma.user.create({
        data: { username: "lookup_user", passwordHash },
      });

      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);

      await prisma.session.create({
        data: {
          userId: user.id,
          sessionTokenHash: tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const found = await prisma.session.findUnique({
        where: { sessionTokenHash: tokenHash },
        include: { user: { select: { id: true, username: true } } },
      });

      expect(found).not.toBeNull();
      expect(found!.user.username).toBe("lookup_user");
    });
  });

  // ===========================================================================
  // Login flow (database level)
  // ===========================================================================
  describe("Login flow (database level)", () => {
    it("creates a session record on valid login", async () => {
      const password = "valid_login_password";
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: { username: "login_user", passwordHash },
      });

      // Simulate login: verify password, create session
      const isValid = await verifyPassword(password, user.passwordHash);
      expect(isValid).toBe(true);

      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);

      await prisma.session.create({
        data: {
          userId: user.id,
          sessionTokenHash: tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const sessionCount = await prisma.session.count({
        where: { userId: user.id },
      });
      expect(sessionCount).toBe(1);
    });

    it("fails safely with wrong password (no session created)", async () => {
      const password = "correct_password_1";
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: { username: "fail_login_user", passwordHash },
      });

      // Attempt with wrong password
      const isValid = await verifyPassword("wrong_password_!!", user.passwordHash);
      expect(isValid).toBe(false);

      // No session should be created
      const sessionCount = await prisma.session.count({
        where: { userId: user.id },
      });
      expect(sessionCount).toBe(0);
    });

    it("fails safely when user does not exist", async () => {
      const user = await prisma.user.findUnique({
        where: { username: "nonexistent_user" },
      });
      expect(user).toBeNull();
    });
  });

  // ===========================================================================
  // Logout (session deletion)
  // ===========================================================================
  describe("Logout (session deletion)", () => {
    it("deletes the current session from the database", async () => {
      const passwordHash = await hashPassword("logout_test_pass");
      const user = await prisma.user.create({
        data: { username: "logout_user", passwordHash },
      });

      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);

      await prisma.session.create({
        data: {
          userId: user.id,
          sessionTokenHash: tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      let sessionCount = await prisma.session.count({
        where: { userId: user.id },
      });
      expect(sessionCount).toBe(1);

      await prisma.session.delete({
        where: { sessionTokenHash: tokenHash },
      });

      sessionCount = await prisma.session.count({
        where: { userId: user.id },
      });
      expect(sessionCount).toBe(0);
    });
  });

  // ===========================================================================
  // Security: never leak sensitive data
  // ===========================================================================
  describe("Security constraints", () => {
    it("user select without passwordHash does not return it", async () => {
      const passwordHash = await hashPassword("security_test_1");
      await prisma.user.create({
        data: { username: "security_user", passwordHash },
      });

      const user = await prisma.user.findUnique({
        where: { username: "security_user" },
        select: { id: true, username: true, role: true, createdAt: true },
      });

      expect(user).not.toBeNull();
      expect(user!.username).toBe("security_user");
      expect((user as any).passwordHash).toBeUndefined();
    });
  });

  // ===========================================================================
  // Business logic edge cases
  // ===========================================================================
  describe("Business Logic & Security Correctness", () => {
    it("suspended existing sessions are rejected and removed", async () => {
      const passwordHash = await hashPassword("suspended_pass");
      const user = await prisma.user.create({
        data: { username: "suspended_sess_user", passwordHash, isSuspended: true },
      });

      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);

      await prisma.session.create({
        data: {
          userId: user.id,
          sessionTokenHash: tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const result = await validateSessionToken(tokenHash, prisma);
      expect(result.success).toBe(false);
      expect(result.success === false && result.error).toBe("Account suspended");

      const sessionCount = await prisma.session.count({ where: { userId: user.id } });
      expect(sessionCount).toBe(0);
    });

    it("expired sessions are rejected and removed from the database", async () => {
      const passwordHash = await hashPassword("expired_pass");
      const user = await prisma.user.create({
        data: { username: "expired_sess_user", passwordHash },
      });

      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);

      await prisma.session.create({
        data: {
          userId: user.id,
          sessionTokenHash: tokenHash,
          expiresAt: new Date(Date.now() - 1000), // already expired
        },
      });

      const result = await validateSessionToken(tokenHash, prisma);
      expect(result.success).toBe(false);
      expect(result.success === false && result.error).toBe("Session expired");

      // Expired session must be cleaned up from the database
      const sessionCount = await prisma.session.count({ where: { userId: user.id } });
      expect(sessionCount).toBe(0);
    });

    it("suspended and nonexistent-account logins return identical generic errors", async () => {
      const password = "valid_password123";
      const passwordHash = await hashPassword(password);
      
      await prisma.user.create({
        data: { username: "suspended_login_user", passwordHash, isSuspended: true },
      });

      const suspendedResult = await verifyCredentials({ username: "suspended_login_user", password }, prisma);
      expect(suspendedResult.success).toBe(false);

      const nonexistentResult = await verifyCredentials({ username: "nonexistent_login_user", password }, prisma);
      expect(nonexistentResult.success).toBe(false);

      const err1 = suspendedResult.success === false ? suspendedResult.error : null;
      const err2 = nonexistentResult.success === false ? nonexistentResult.error : null;
      
      expect(err1).toBe(err2);
      expect(err1).toBe("Invalid username or password");
    });

    it("duplicate concurrent registration is handled safely without an unhandled exception", async () => {
      const originalValue = process.env.ALLOW_PUBLIC_REGISTRATION;
      process.env.ALLOW_PUBLIC_REGISTRATION = "true";

      try {
        const [res1, res2] = await Promise.all([
          registerUser({ username: "concurrent_user", password: "valid_password123" }, prisma),
          registerUser({ username: "concurrent_user", password: "valid_password123" }, prisma),
        ]);

        const successes = [res1.success, res2.success];
        expect(successes).toContain(true);
        expect(successes).toContain(false);

        const failedResult = res1.success === false ? res1 : (res2.success === false ? res2 : null);
        expect(failedResult!.error).toBe("Username is already taken");
      } finally {
        process.env.ALLOW_PUBLIC_REGISTRATION = originalValue;
      }
    });

    it("successful registerUser, verifyCredentials, and validateSessionToken results never contain passwordHash", async () => {
      const originalValue = process.env.ALLOW_PUBLIC_REGISTRATION;
      process.env.ALLOW_PUBLIC_REGISTRATION = "true";

      try {
        const username = "privacy_test_user";
        const password = "valid_password123";

        // 1. registerUser must not return passwordHash
        const regResult = await registerUser({ username, password }, prisma);
        expect(regResult.success).toBe(true);
        if (regResult.success) {
          expect(regResult.data).toHaveProperty("id");
          expect((regResult.data as Record<string, unknown>).passwordHash).toBeUndefined();
          expect("passwordHash" in regResult.data).toBe(false);
        }

        // 2. verifyCredentials must not return passwordHash
        const loginResult = await verifyCredentials({ username, password }, prisma);
        expect(loginResult.success).toBe(true);
        if (loginResult.success) {
          expect(loginResult.data).toHaveProperty("id");
          expect((loginResult.data as Record<string, unknown>).passwordHash).toBeUndefined();
          expect("passwordHash" in loginResult.data).toBe(false);
        }

        // 3. validateSessionToken must return safe public user and not passwordHash
        const rawToken = generateSessionToken();
        const tokenHash = hashSessionToken(rawToken);
        if (loginResult.success) {
          await prisma.session.create({
            data: {
              userId: loginResult.data.id,
              sessionTokenHash: tokenHash,
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          });
        }

        const sessionResult = await validateSessionToken(tokenHash, prisma);
        expect(sessionResult.success).toBe(true);
        if (sessionResult.success) {
          expect(sessionResult.data).toHaveProperty("id");
          expect(sessionResult.data).toHaveProperty("username", username);
          expect(sessionResult.data).toHaveProperty("role");
          expect(sessionResult.data).toHaveProperty("createdAt");
          expect((sessionResult.data as Record<string, unknown>).passwordHash).toBeUndefined();
          expect("passwordHash" in sessionResult.data).toBe(false);
        }
      } finally {
        process.env.ALLOW_PUBLIC_REGISTRATION = originalValue;
      }
    });
  });
});
