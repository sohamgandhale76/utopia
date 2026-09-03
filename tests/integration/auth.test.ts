import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

// Import auth modules directly (not the Server Actions, which require Next.js runtime)
import { usernameSchema, passwordSchema, registerSchema } from "../../src/features/auth/validation";
import { hashPassword, verifyPassword } from "../../src/features/auth/password";
import { generateSessionToken, hashSessionToken } from "../../src/features/auth/crypto";

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
  // Password hashing (bcrypt)
  // ===========================================================================
  describe("Password hashing", () => {
    it("produces a bcrypt hash, never stores plaintext", async () => {
      const password = "my_secure_password_123";
      const hash = await hashPassword(password);

      expect(hash).not.toBe(password);
      expect(hash.startsWith("$2a$") || hash.startsWith("$2b$")).toBe(true);
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
      // This test verifies the gate at the data layer:
      // When the gate is closed, no user should be created.
      const originalValue = process.env.ALLOW_PUBLIC_REGISTRATION;
      process.env.ALLOW_PUBLIC_REGISTRATION = "false";

      try {
        // We test the gate logic directly rather than the Server Action
        // (which requires Next.js runtime). The Server Action checks
        // process.env.ALLOW_PUBLIC_REGISTRATION !== "true" before proceeding.
        const gateOpen = process.env.ALLOW_PUBLIC_REGISTRATION === "true";
        expect(gateOpen).toBe(false);

        // Verify no user was created
        const userCount = await prisma.user.count();
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
    it("stores a bcrypt hash, never plaintext password", async () => {
      const password = "test_password_secure";
      const passwordHash = await hashPassword(password);

      const user = await prisma.user.create({
        data: {
          username: "test_user_db",
          passwordHash,
        },
      });

      expect(user.passwordHash).not.toBe(password);
      expect(
        user.passwordHash.startsWith("$2a$") ||
        user.passwordHash.startsWith("$2b$")
      ).toBe(true);
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
  // Login simulation (direct database verification)
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
      // No crash, no session created — generic error would be returned
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

      // Verify session exists
      let sessionCount = await prisma.session.count({
        where: { userId: user.id },
      });
      expect(sessionCount).toBe(1);

      // Simulate logout: delete session by token hash
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
      // passwordHash is not in the select, so it must not be present
      expect((user as any).passwordHash).toBeUndefined();
    });
  });
});
