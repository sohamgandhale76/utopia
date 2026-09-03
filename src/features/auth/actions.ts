"use server";

import { db } from "@/lib/db";
import { registerSchema, loginSchema } from "./validation";
import { hashPassword, verifyPassword } from "./password";
import { createSession, destroySession } from "./session";

// =============================================================================
// Result type for Server Actions (never leaks secrets or hashes to the client)
// =============================================================================
export type AuthResult = {
  success: boolean;
  error?: string;
};

// =============================================================================
// REGISTER
// =============================================================================
export async function register(formData: FormData): Promise<AuthResult> {
  // 1. Check registration gate
  if (process.env.ALLOW_PUBLIC_REGISTRATION !== "true") {
    return {
      success: false,
      error:
        "Public registration is currently disabled. An abuse-control mechanism must be implemented before registration is opened.",
    };
  }

  // 2. Validate input
  const raw = {
    username: formData.get("username"),
    password: formData.get("password"),
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    return { success: false, error: firstError };
  }

  const { username, password } = parsed.data;

  // 3. Check uniqueness
  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    return { success: false, error: "Username is already taken" };
  }

  // 4. Hash password (bcrypt 12 rounds)
  const passwordHash = await hashPassword(password);

  // 5. Create user
  const user = await db.user.create({
    data: {
      username,
      passwordHash,
    },
  });

  // 6. Create session
  await createSession(user.id);

  return { success: true };
}

// =============================================================================
// LOGIN
// =============================================================================
export async function login(formData: FormData): Promise<AuthResult> {
  // 1. Validate input shape
  const raw = {
    username: formData.get("username"),
    password: formData.get("password"),
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    return { success: false, error: firstError };
  }

  const { username, password } = parsed.data;

  // 2. Find user — use generic error message to avoid revealing whether
  //    a username exists.
  const GENERIC_ERROR = "Invalid username or password";

  const user = await db.user.findUnique({ where: { username } });
  if (!user) {
    return { success: false, error: GENERIC_ERROR };
  }

  // 3. Check suspended
  if (user.isSuspended) {
    return { success: false, error: "This account has been suspended" };
  }

  // 4. Verify password
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { success: false, error: GENERIC_ERROR };
  }

  // 5. Create session
  await createSession(user.id);

  return { success: true };
}

// =============================================================================
// LOGOUT
// =============================================================================
export async function logout(): Promise<AuthResult> {
  await destroySession();
  return { success: true };
}
