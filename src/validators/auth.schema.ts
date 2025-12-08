import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*                               PHONE HELPERS                                 */
/* -------------------------------------------------------------------------- */

/**
 * Strict E.164 validation (required across all auth flows)
 * Examples:
 *  +919876543210
 *  +14155552671
 */
export const phoneE164 = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Invalid phone number (must be E.164 format)");

export const purposeEnum = z.enum(["signup", "login"]);

/* -------------------------------------------------------------------------- */
/*                               1) REQUEST OTP                                */
/* -------------------------------------------------------------------------- */

export const requestOtpSchema = z.object({
  phone: phoneE164,
  purpose: purposeEnum,

  // Minimal optional metadata — ONLY fullName (email removed)
  metadata: z
    .object({
      fullName: z.string().max(120).optional(),
    })
    .optional(),
});

/* -------------------------------------------------------------------------- */
/*                                2) VERIFY OTP                                */
/* -------------------------------------------------------------------------- */

export const verifyOtpSchema = z.object({
  sessionId: z.string().uuid(),
  otp: z.string().regex(/^\d{4,8}$/, "Invalid OTP format"),
});

/* -------------------------------------------------------------------------- */
/*           3) SET PASSWORD (after OTP, phoneVerified = true)                 */
/* -------------------------------------------------------------------------- */

export const setPasswordSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
});

/* -------------------------------------------------------------------------- */
/*                     4) LOGIN WITH PASSWORD (phone + password)              */
/* -------------------------------------------------------------------------- */

export const loginPasswordSchema = z.object({
  phone: phoneE164,
  password: z.string().min(1),
});

/* -------------------------------------------------------------------------- */
/*                             5) REFRESH TOKEN                                */
/* -------------------------------------------------------------------------- */

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

/* -------------------------------------------------------------------------- */
/*                                 6) LOGOUT                                   */
/* -------------------------------------------------------------------------- */

export const logoutSchema = z.object({
  refreshToken: z.string().min(20),
});