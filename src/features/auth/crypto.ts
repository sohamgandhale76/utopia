import { randomBytes, createHash } from "crypto";

/**
 * Generate a 256-bit (32-byte) cryptographically random session token.
 * Returns the raw hex-encoded token (64 hex characters).
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Compute SHA-256 hash of a raw session token.
 * Only this hash is stored in PostgreSQL; the raw token is never persisted.
 */
export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
