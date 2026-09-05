import { db } from "@/lib/db";
import { Prisma, Role } from "@prisma/client";
import { RegisterInput, LoginInput } from "./validation";
import { hashPassword, verifyPassword, needsRehash } from "./password";
import {
  ipBurstLimiter,
  argon2CircuitBreaker,
  ipUserFailureLimiter,
} from "./rate-limit";

// =============================================================================
// Result types for business logic
// =============================================================================
export type AuthUserSummary = {
  id: string;
};

export type SafeSessionUser = {
  id: string;
  username: string;
  role: Role;
  createdAt: Date;
};

export type ServiceResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

export interface VerifyCredentialsOptions {
  clientIp?: string | null;
}

// =============================================================================
// REGISTER BUSINESS LOGIC
// =============================================================================
export async function registerUser(
  input: RegisterInput,
  prisma: any = db
): Promise<ServiceResult<AuthUserSummary>> {
  // 1. Check registration gate
  if (process.env.ALLOW_PUBLIC_REGISTRATION !== "true") {
    return {
      success: false,
      error:
        "Public registration is currently disabled. An abuse-control mechanism must be implemented before registration is opened.",
    };
  }

  // 2. Hash password (Argon2id)
  const passwordHash = await hashPassword(input.password);

  // 3. Create user (handle unique constraint for username)
  try {
    const user = await prisma.user.create({
      data: {
        username: input.username,
        passwordHash,
      },
      select: {
        id: true,
      },
    });
    return { success: true, data: { id: user.id } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002: "Unique constraint failed on the {constraint}"
      if (e.code === "P2002") {
        return { success: false, error: "Username is already taken" };
      }
    }
    throw e;
  }
}

// =============================================================================
// VERIFY CREDENTIALS BUSINESS LOGIC
// =============================================================================
export async function verifyCredentials(
  input: LoginInput,
  prisma: any = db,
  options?: VerifyCredentialsOptions
): Promise<ServiceResult<AuthUserSummary>> {
  const GENERIC_ERROR = "Invalid username or password";
  const OVERLOAD_ERROR = "Too many login attempts. Please try again later.";
  const clientIp = options?.clientIp;

  // 1. IP Burst Protection (cheap in-memory check before DB or Argon2)
  if (clientIp) {
    const burst = ipBurstLimiter.consume(clientIp);
    if (!burst.allowed) {
      return { success: false, error: OVERLOAD_ERROR };
    }

    // Check if this (IP, username) pair has exceeded failed attempts
    if (ipUserFailureLimiter.isBlocked(clientIp, input.username)) {
      return { success: false, error: OVERLOAD_ERROR };
    }
  }

  // 2. Lookup user in database
  const user = await prisma.user.findUnique({
    where: { username: input.username },
    select: {
      id: true,
      passwordHash: true,
      isSuspended: true,
    },
  });
  if (!user) {
    // Non-existent username: DO NOT perform dummy Argon2 hashing!
    return { success: false, error: GENERIC_ERROR };
  }

  // Suspended account returns the exact same generic error to prevent enumeration
  if (user.isSuspended) {
    return { success: false, error: GENERIC_ERROR };
  }

  // 3. Acquire Argon2 concurrency slot (strictly caps active verifications)
  if (!argon2CircuitBreaker.tryAcquire()) {
    return { success: false, error: OVERLOAD_ERROR };
  }

  let valid = false;
  try {
    valid = await verifyPassword(input.password, user.passwordHash);
  } finally {
    argon2CircuitBreaker.release();
  }

  if (!valid) {
    // Wrong password: record failure for this (IP, username) pair if IP is known
    if (clientIp) {
      ipUserFailureLimiter.recordFailure(clientIp, input.username);
    }
    return { success: false, error: GENERIC_ERROR };
  }

  // Correct password: clear transient failure state for this (IP, username) pair
  if (clientIp) {
    ipUserFailureLimiter.clearFailure(clientIp, input.username);
  }

  // Login-time migration: if legacy bcrypt or outdated Argon2 parameters, rehash to current Argon2id
  if (needsRehash(user.passwordHash)) {
    try {
      const newHash = await hashPassword(input.password);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });
    } catch {
      // Rehash failure must not block successful login or leak sensitive data
    }
  }

  return { success: true, data: { id: user.id } };
}

// =============================================================================
// VALIDATE SESSION TOKEN BUSINESS LOGIC
// =============================================================================
export async function validateSessionToken(
  tokenHash: string,
  prisma: any = db
): Promise<ServiceResult<SafeSessionUser>> {
  const session = await prisma.session.findUnique({
    where: { sessionTokenHash: tokenHash },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          role: true,
          isSuspended: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session) {
    return { success: false, error: "Invalid session" };
  }

  // Check expiry
  if (session.expiresAt < new Date()) {
    // Expired session: clean up
    await prisma.session.delete({ where: { id: session.id } });
    return { success: false, error: "Session expired" };
  }

  // Check if suspended
  if (session.user.isSuspended) {
    // Revoke session if suspended
    await prisma.session.delete({ where: { id: session.id } });
    return { success: false, error: "Account suspended" };
  }

  return {
    success: true,
    data: {
      id: session.user.id,
      username: session.user.username,
      role: session.user.role,
      createdAt: session.user.createdAt,
    },
  };
}
