import argon2 from "argon2";
import bcrypt from "bcryptjs";

export const ARGON2_OPTIONS: argon2.HashOptions & { raw: false } = {
  type: argon2.argon2id,
  version: 0x13, // version 19
  memoryCost: 65536, // 64 MiB (65536 KiB)
  timeCost: 3, // 3 iterations
  parallelism: 4, // 4 threads
  raw: false,
};

/**
 * Hash a plaintext password with Argon2id using OWASP / RFC 9106 recommended parameters.
 * Uses the library's built-in cryptographically secure salt generator (16 bytes random salt).
 * Returns the standard encoded string: $argon2id$v=19$m=65536,p=4,t=3$...
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Compare a plaintext password against an encoded hash with explicit algorithm dispatch:
 * - $argon2id$ -> verify using Argon2
 * - $2a$, $2b$, or $2y$ -> verify using bcryptjs (for legacy migration)
 * - any other format -> return false
 *
 * Wrapped in try/catch so malformed/tampered hashes return false safely without throwing.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  if (typeof password !== "string" || typeof hash !== "string") {
    return false;
  }

  if (hash.startsWith("$argon2id$")) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  if (
    hash.startsWith("$2a$") ||
    hash.startsWith("$2b$") ||
    hash.startsWith("$2y$")
  ) {
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Check whether a hash requires rehashing:
 * - legacy bcrypt hash -> true
 * - Argon2id hash with outdated/different parameters -> true
 * - Argon2id hash with current parameters -> false
 * - unknown/malformed hash -> false
 */
export function needsRehash(hash: string): boolean {
  if (
    hash.startsWith("$2a$") ||
    hash.startsWith("$2b$") ||
    hash.startsWith("$2y$")
  ) {
    return true;
  }

  if (hash.startsWith("$argon2id$")) {
    try {
      return argon2.needsRehash(hash, ARGON2_OPTIONS);
    } catch {
      return true;
    }
  }

  return false;
}
