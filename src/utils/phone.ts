// src/utils/phone.ts
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

/**
 * Normalize raw phone into E.164 format.
 *
 * Examples:
 *   "9876543210"       → "+919876543210"
 *   "09876543210"      → "+919876543210"
 *   "+14155552671"     → "+14155552671"
 *   "919876543210"     → "+919876543210"
 *
 * Default region = IN (India-first).
 */
export function normalizePhoneToE164(
  raw: string,
  defaultRegion: CountryCode = "IN"
): string {
  if (!raw) return "";

  // Clean whitespace
  const input = raw.trim();

  // If already valid E.164 -> return directly
  if (isE164(input)) return input;

  // Parse using libphonenumber-js
  const parsed = parsePhoneNumberFromString(input, {
    defaultCountry: defaultRegion,
  });

  if (parsed && parsed.isValid()) {
    return parsed.number; // E.164
  }

  return "";
}

/**
 * Validate E.164 format strictly.
 */
export function isE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

/**
 * Mask phone for audit logs.
 * "+919876543210" → "+91******3210"
 */
export function maskPhone(phone: string): string {
  if (!isE164(phone)) return phone;

  const cc = phone.slice(0, 3); // e.g., "+91"
  const last4 = phone.slice(-4);
  return `${cc}******${last4}`;
}
