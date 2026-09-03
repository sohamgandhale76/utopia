import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

/**
 * Hash a plaintext password with bcrypt (12 rounds).
 * The caller must validate password length before calling this.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Compare a plaintext password against a bcrypt hash.
 * Returns true if they match.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
