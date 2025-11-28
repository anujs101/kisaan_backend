import express from "express";
import {
  requestOtpHandler,
  verifyOtpHandler,
  setPasswordHandler,
  loginPasswordHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
} from "@controllers/auth.controller";

import {
  requestOtpSchema,
  verifyOtpSchema,
  setPasswordSchema,
  loginPasswordSchema,
  refreshSchema,
  logoutSchema,
} from "@validators/auth.schema";

import { validate } from "@middleware/validate";
import { auth } from "@middleware/auth";

const router = express.Router();

// 1) Request OTP (signup or login)
router.post("/request-otp", validate(requestOtpSchema, "body"), requestOtpHandler);

// 2) Verify OTP (sessionId + otp)
router.post("/verify-otp", validate(verifyOtpSchema, "body"), verifyOtpHandler);

// 3) Set password (AFTER OTP verified)
router.post("/set-password", auth(), validate(setPasswordSchema, "body"), setPasswordHandler);

// 4) Login with password
router.post("/login-password", validate(loginPasswordSchema, "body"), loginPasswordHandler);

// 5) Refresh access token
router.post("/refresh", validate(refreshSchema, "body"), refreshHandler);

// 6) Logout
router.post("/logout", validate(logoutSchema, "body"), logoutHandler);

// 7) Get profile
router.get("/me", auth(), meHandler);

export default router;
