// src/services/twilio.ts
import { config } from "@lib/config";
import type { VerificationInstance } from "twilio/lib/rest/verify/v2/service/verification";
import type { VerificationCheckInstance } from "twilio/lib/rest/verify/v2/service/verificationCheck";

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID } = config;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SID) {
  throw new Error("Twilio environment variables missing");
}

const client = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

/**
 * Start OTP verification via Twilio Verify.
 *
 * You can choose "sms" or "whatsapp". WhatsApp is free in sandbox mode.
 */
export async function startVerification(
  phone: string,
  channel: "sms" | "whatsapp" = "sms"
): Promise<{
  verificationSid: string;
  messageSid?: string;
  meta: any;
}> {
  try {
    const verification: VerificationInstance = await client.verify.v2
      .services(TWILIO_VERIFY_SID)
      .verifications.create({
        to: phone,
        channel,
      });

    return {
      verificationSid: verification.sid,
      messageSid: verification?.sendCodeAttempts?.[0]?.channel,
      meta: {
        status: verification.status,
        channel: verification.channel,
      },
    };
  } catch (err: any) {
    console.error("Twilio startVerification error:", err);
    throw new Error(
      err?.message || "Failed to start OTP verification with Twilio"
    );
  }
}

/**
 * Verify OTP for a phone number.
 *
 * @returns true if OTP is valid, else false.
 */
export async function checkVerification(
  verificationSid: string | undefined,
  phone: string,
  otp: string
): Promise<boolean> {
  if (!verificationSid) return false;

  try {
    const resp: VerificationCheckInstance = await client.verify.v2
      .services(TWILIO_VERIFY_SID)
      .verificationChecks.create({
        verificationSid,
        to: phone,
        code: otp,
      });

    return resp.status === "approved";
  } catch (err: any) {
    // Twilio returns 400/404 for invalid OTP
    if (err?.status === 400 || err?.status === 404) {
      return false;
    }

    console.error("Twilio checkVerification error:", err);
    throw new Error(err?.message || "OTP verification failed");
  }
}
