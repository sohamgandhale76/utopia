import { z } from "zod";

// =============================================================================
// Username: lowercase only, 3-24 characters, alphanumeric + underscore
// =============================================================================
export const USERNAME_REGEX = /^[a-z0-9_]{3,24}$/;

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(24, "Username must be at most 24 characters")
  .regex(
    USERNAME_REGEX,
    "Username must contain only lowercase letters, digits, and underscores"
  );

// =============================================================================
// Password: 12-64 UTF-8 bytes
// =============================================================================
// We enforce character length >= 12 and then check byte length <= 64.
// This 64-byte cap protects against DoS/resource-exhaustion attacks on memory-hard
// Argon2id hashing while preserving full Unicode password support.
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .refine(
    (val) => new TextEncoder().encode(val).length <= 64,
    "Password must be at most 64 bytes (UTF-8)"
  );

// =============================================================================
// Registration form schema
// =============================================================================
export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

// =============================================================================
// Login form schema
// =============================================================================
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
