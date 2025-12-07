// scripts/twilio-diagnose.ts
// Run with: bun run scripts/twilio-diagnose.ts  OR node (ts-node) if you have that setup.
// Purpose: safe diagnostics only — will NOT print tokens.

import twilio from "twilio";

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set in environment`);
  return v;
}

async function run() {
  try {
    const accountSid = envOrThrow("TWILIO_ACCOUNT_SID");
    const authToken = envOrThrow("TWILIO_AUTH_TOKEN");
    const verifySid = envOrThrow("TWILIO_VERIFY_SID");

    console.log("Detected TWILIO_ACCOUNT_SID prefix:", accountSid.slice(0, 2));
    console.log("Detected TWILIO_VERIFY_SID prefix:", verifySid.slice(0, 2));

    // Quick sanity checks (non-sensitive)
    if (!accountSid.startsWith("AC")) {
      console.warn("WARNING: TWILIO_ACCOUNT_SID does not start with 'AC'. Are you using the correct value?");
    }
    if (!verifySid.startsWith("VA")) {
      console.warn(
        "WARNING: TWILIO_VERIFY_SID does not start with 'VA'. It looks like you might have placed an API Key (SK...) or other value in TWILIO_VERIFY_SID. The Verify Service SID must start with 'VA...'."
      );
    }

    // Create client. If you are using API Key/Secret instead of AccountSID/AuthToken,
    // replace the constructor accordingly and ensure TWILIO_API_SECRET is available.
    const client = twilio(accountSid, authToken);

    // Attempt to fetch the Verify Service metadata (will error clearly if not found / unauthorized)
    try {
      const svc = await client.verify.services(verifySid).fetch();
      console.log("✅ Found Verify Service:");
      console.log("  SID:", svc.sid);
      console.log("  FriendlyName:", svc.friendlyName || "(none)");
      console.log("  Status:", (svc as any).status || "n/a"); // some fields change, just show friendlyName at minimum
    } catch (err: unknown) {
      // Provide clear advice without exposing secrets
      const msg = err && typeof err === "object" && "message" in err ? (err as any).message : String(err);
      console.error("Failed to fetch Verify Service. Message:", msg);
      console.error(
        "If you get a 401 or authentication error: re-check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. If you get a 404: make sure TWILIO_VERIFY_SID is a valid VA... service SID."
      );
      process.exitCode = 2;
    }
  } catch (e: unknown) {
    console.error("Diagnostic failed:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}

run();