"use server";

import { headers } from "next/headers";
import { registerSchema, loginSchema } from "./validation";
import { createSession, destroySession } from "./session";
import { registerUser, verifyCredentials } from "./service";
import { getClientIp } from "./rate-limit";

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
  // 1. Validate input shape
  const raw = {
    username: formData.get("username"),
    password: formData.get("password"),
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    return { success: false, error: firstError };
  }

  // 2. Delegate to business logic
  const result = await registerUser(parsed.data);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  // 3. Create session (requires next/headers so stays in Server Action)
  await createSession(result.data.id);

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

  // 2. Resolve client IP if trusted proxy configuration is enabled
  const headerStore = await headers();
  const clientIp = getClientIp(headerStore);

  // 3. Delegate to business logic with clientIp
  const result = await verifyCredentials(parsed.data, undefined, { clientIp });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  // 4. Create session
  await createSession(result.data.id);

  return { success: true };
}

// =============================================================================
// LOGOUT
// =============================================================================
export async function logout(): Promise<AuthResult> {
  await destroySession();
  return { success: true };
}
