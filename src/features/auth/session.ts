import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { generateSessionToken, hashSessionToken } from "./crypto";
import { validateSessionToken, SafeSessionUser } from "./service";

export { generateSessionToken, hashSessionToken };
export type { SafeSessionUser };

const SESSION_COOKIE_NAME = "session_token";
const SESSION_EXPIRY_DAYS = 30;

/**
 * Create a new session in the database and set the HttpOnly cookie.
 * - Stores only the SHA-256 hash of the token in PostgreSQL.
 * - Sets the raw token in an HttpOnly, SameSite=Lax cookie.
 * - Secure flag is set only in production (HTTPS).
 */
export async function createSession(userId: string): Promise<void> {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  await db.session.create({
    data: {
      userId,
      sessionTokenHash: tokenHash,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Get the current authenticated user from the session cookie.
 * Returns null if no valid session exists, session is expired, or user is suspended.
 * Never returns passwords, hashes, or secrets.
 */
export async function getCurrentUser(): Promise<SafeSessionUser | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);
  
  const result = await validateSessionToken(tokenHash);
  if (!result.success) return null;
  
  return result.data;
}

/**
 * Require an authenticated user. Throws if not authenticated.
 * Used in Server Actions/route handlers that require auth.
 */
export async function requireUser(): Promise<SafeSessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}

/**
 * Destroy the current session: delete from database and clear the cookie.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return;

  const tokenHash = hashSessionToken(rawToken);

  // Delete the session record (ignore if already deleted)
  await db.session
    .delete({ where: { sessionTokenHash: tokenHash } })
    .catch(() => {});

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
