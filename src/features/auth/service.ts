import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { RegisterInput, LoginInput } from "./validation";
import { hashPassword, verifyPassword } from "./password";
import { User } from "@prisma/client";

// =============================================================================
// Result types for business logic
// =============================================================================
export type ServiceResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

// =============================================================================
// REGISTER BUSINESS LOGIC
// =============================================================================
export async function registerUser(
  input: RegisterInput,
  prisma: any = db
): Promise<ServiceResult<User>> {
  // 1. Check registration gate
  if (process.env.ALLOW_PUBLIC_REGISTRATION !== "true") {
    return {
      success: false,
      error:
        "Public registration is currently disabled. An abuse-control mechanism must be implemented before registration is opened.",
    };
  }

  // 2. Hash password (bcrypt 12 rounds)
  const passwordHash = await hashPassword(input.password);

  // 3. Create user (handle unique constraint for username)
  try {
    const user = await prisma.user.create({
      data: {
        username: input.username,
        passwordHash,
      },
    });
    return { success: true, data: user };
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
  prisma: any = db
): Promise<ServiceResult<User>> {
  const GENERIC_ERROR = "Invalid username or password";

  const user = await prisma.user.findUnique({ where: { username: input.username } });
  if (!user) {
    return { success: false, error: GENERIC_ERROR };
  }

  // Suspended account returns the exact same generic error to prevent enumeration
  if (user.isSuspended) {
    return { success: false, error: GENERIC_ERROR };
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    return { success: false, error: GENERIC_ERROR };
  }

  return { success: true, data: user };
}

// =============================================================================
// VALIDATE SESSION TOKEN BUSINESS LOGIC
// =============================================================================
export async function validateSessionToken(
  tokenHash: string,
  prisma: any = db
): Promise<ServiceResult<User>> {
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

  // user object needs casting since it's a partial select from Prisma, 
  // but it's safe to return as User for our ServiceResult purposes or we can cast it
  return { success: true, data: session.user as User };
}
