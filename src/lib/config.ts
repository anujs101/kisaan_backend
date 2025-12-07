// src/lib/config.ts
import dotenv from "dotenv";
import assert from "assert";

dotenv.config({ path: process.cwd() + "/.env" });

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SID,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  DATABASE_URL,
} = process.env;


// Basic runtime checks
assert(DATABASE_URL, "DATABASE_URL is required");
assert(JWT_ACCESS_SECRET, "JWT_ACCESS_SECRET is required");
assert(JWT_REFRESH_SECRET, "JWT_REFRESH_SECRET is required");

// For Twilio we keep the same-fast-fail behaviour, but accept either env key
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SID) {
  throw new Error(
    "Twilio environment variables missing: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SID"
  );
}

export const config = {
  DATABASE_URL,
  JWT_ACCESS_SECRET: JWT_ACCESS_SECRET!,
  JWT_REFRESH_SECRET: JWT_REFRESH_SECRET!,
  TWILIO_ACCOUNT_SID: TWILIO_ACCOUNT_SID!,
  TWILIO_AUTH_TOKEN: TWILIO_AUTH_TOKEN!,
  TWILIO_VERIFY_SID: TWILIO_VERIFY_SID!,
};