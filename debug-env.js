console.log({
  PWD: process.cwd(),
  ENV_FILE_EXISTS: require('fs').existsSync('.env'),
  TWILIO_ACCOUNT_SID_present: !!process.env.TWILIO_ACCOUNT_SID,
  TWILIO_ACCOUNT_SID_len: process.env.TWILIO_ACCOUNT_SID ? process.env.TWILIO_ACCOUNT_SID.length : 0,
  TWILIO_AUTH_TOKEN_present: !!process.env.TWILIO_AUTH_TOKEN,
  TWILIO_AUTH_TOKEN_len: process.env.TWILIO_AUTH_TOKEN ? process.env.TWILIO_AUTH_TOKEN.length : 0,
  TWILIO_VERIFY_SID_present: !!process.env.TWILIO_VERIFY_SID,
  TWILIO_VERIFY_SID_len: process.env.TWILIO_VERIFY_SID ? process.env.TWILIO_VERIFY_SID.length : 0,
});
