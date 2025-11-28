// src/controllers/auth.controller.ts
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { ZodError } from "zod";
import { prisma } from "@lib/prisma";
import {
  requestOtpSchema,
  verifyOtpSchema,
  setPasswordSchema,
  loginPasswordSchema,
  refreshSchema,
  logoutSchema
} from "@validators/auth.schema";
import { Prisma } from "@prisma/client";
import { fromZodError, APIError } from "@utils/errors";
import {
  signAccessToken,
  createAndStoreRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  ACCESS_TOKEN_EXPIRES_SECONDS
} from "@utils/jwt";

import { normalizePhoneToE164, isE164 } from "@utils/phone";
import * as twilioService from "@services/twilio";
import { addAuditLog } from "@utils/audit";

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);

function send(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

/* -------------------------------------------------------------------------- */
/*                            REQUEST OTP (signup/login)                       */
/* -------------------------------------------------------------------------- */
export async function requestOtpHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = requestOtpSchema.parse(req.body);
    const { phone: rawPhone, purpose, metadata, clientNonce } = parsed;

    const phone = normalizePhoneToE164(rawPhone);
    if (!isE164(phone)) throw new APIError("Invalid phone number", 400);

    // 10-minute session
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const authSession = await prisma.authSession.create({
      data: {
        phone,
        purpose,
        metadata: metadata ?? Prisma.JsonNull,
        clientNonce: clientNonce ?? null,
        requestIp: req.ip,
        userAgent: req.get("user-agent") ?? null,
        expiresAt
      }
    });

    const providerResp = await twilioService.startVerification(phone);

    await prisma.phoneOtp.create({
      data: {
        phone,
        purpose,
        attempts: 0,
        used: false,
        expiresAt,
        provider: "twilio",
        providerMeta: providerResp.meta ?? null,
        messageSid: providerResp.messageSid ?? null,
        verificationSid: providerResp.verificationSid ?? null,
        authSessionId: authSession.id
      }
    });

    await addAuditLog({
      eventType: "otp_requested",
      relatedId: authSession.id,
      payload: { phone: phone.replace(/.(?=.{4})/g, "*"), purpose },
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null
    });

    return send(res, 200, {
      status: "ok",
      data: { sessionId: authSession.id, ttlSeconds: 600 }
    });
  } catch (err) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/* -------------------------------------------------------------------------- */
/*                                VERIFY OTP                                   */
/* -------------------------------------------------------------------------- */
export async function verifyOtpHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = verifyOtpSchema.parse(req.body);
    const { sessionId, otp } = parsed;

    const session = await prisma.authSession.findUnique({
      where: { id: sessionId }
    });

    if (!session) throw new APIError("Session not found", 400, "SESSION_NOT_FOUND");
    if (session.expiresAt < new Date())
      throw new APIError("Session expired", 400, "SESSION_EXPIRED");

    const otpRow = await prisma.phoneOtp.findFirst({
      where: { authSessionId: sessionId, used: false },
      orderBy: { createdAt: "desc" }
    });

    if (!otpRow) throw new APIError("OTP not found or used", 400);

    if (otpRow.attempts >= 5) {
      await prisma.phoneOtp.update({
        where: { id: otpRow.id },
        data: { used: true }
      });
      throw new APIError("Too many attempts", 403, "OTP_LOCKED");
    }

    const verified = await twilioService.checkVerification(
      otpRow.verificationSid ?? undefined,
      session.phone,
      otp
    );

    if (!verified) {
      await prisma.phoneOtp.update({
        where: { id: otpRow.id },
        data: { attempts: { increment: 1 } }
      });
      throw new APIError("Invalid OTP", 401, "INVALID_OTP");
    }

    await prisma.phoneOtp.update({
      where: { id: otpRow.id },
      data: { used: true }
    });

    /* ------------------------- USER CREATION / LOGIN ------------------------- */
    let user = await prisma.user.findUnique({
      where: { phone: session.phone }
    });

    if (session.purpose === "signup") {
      if (user) {
        if (!user.phoneVerified) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              phoneVerified: true,
              fullName:
                user.fullName ??
                (session.metadata as any)?.fullName ??
                null,
              email: user.email ?? (session.metadata as any)?.email ?? null
            }
          });
        }
      } else {
        user = await prisma.user.create({
          data: {
            phone: session.phone,
            phoneVerified: true,
            email: (session.metadata as any)?.email ?? null,
            emailVerified: false,
            fullName: (session.metadata as any)?.fullName ?? null
          }
        });
      }
    } else {
      // purpose = login
      if (!user) throw new APIError("User not found", 404, "USER_NOT_FOUND");
      if (!user.phoneVerified) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { phoneVerified: true }
        });
      }
    }

    const { refreshTokenPlain, expiresAt } = await createAndStoreRefreshToken(
      user.id,
      req
    );

    const accessToken = signAccessToken({
      sub: user.id,
      phone: user.phone
    });

    await addAuditLog({
      eventType: "otp_verified",
      userId: user.id,
      relatedId: session.id,
      payload: { purpose: session.purpose },
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null
    });

    return send(res, 200, {
      status: "ok",
      data: {
        user: {
          id: user.id,
          phone: user.phone,
          phoneVerified: user.phoneVerified,
          fullName: user.fullName,
          email: user.email
        },
        tokens: {
          accessToken,
          expiresIn: ACCESS_TOKEN_EXPIRES_SECONDS,
          refreshToken: refreshTokenPlain,
          refreshExpiresAt: expiresAt.toISOString()
        }
      }
    });
  } catch (err) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/* -------------------------------------------------------------------------- */
/*                              SET PASSWORD (after signup OTP)                */
/* -------------------------------------------------------------------------- */
export async function setPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = setPasswordSchema.parse(req.body);
    const { password } = parsed;

    const userId = (req as any).user?.id;
    if (!userId)
      throw new APIError("Not authenticated", 401, "UNAUTHORIZED");

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });

    await addAuditLog({
      eventType: "password_set",
      userId,
      payload: {},
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null
    });

    return send(res, 200, {
      status: "ok",
      data: { message: "Password set successfully" }
    });
  } catch (err) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/* -------------------------------------------------------------------------- */
/*                           LOGIN WITH PASSWORD (phone + password)            */
/* -------------------------------------------------------------------------- */
export async function loginPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = loginPasswordSchema.parse(req.body);
    const { phone: rawPhone, password } = parsed;

    const phone = normalizePhoneToE164(rawPhone);
    if (!isE164(phone)) throw new APIError("Invalid phone number", 400);

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user || !user.passwordHash)
      throw new APIError("Invalid credentials", 401);

    if (!user.phoneVerified)
      throw new APIError("Phone not verified", 403);

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new APIError("Invalid credentials", 401);

    const accessToken = signAccessToken({ sub: user.id, phone: user.phone });
    const { refreshTokenPlain, expiresAt } =
      await createAndStoreRefreshToken(user.id, req);

    await addAuditLog({
      eventType: "login_password",
      userId: user.id,
      payload: {},
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null
    });

    return send(res, 200, {
      status: "ok",
      data: {
        user: {
          id: user.id,
          phone: user.phone,
          fullName: user.fullName,
          email: user.email
        },
        tokens: {
          accessToken,
          expiresIn: ACCESS_TOKEN_EXPIRES_SECONDS,
          refreshToken: refreshTokenPlain,
          refreshExpiresAt: expiresAt.toISOString()
        }
      }
    });
  } catch (err) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/* -------------------------------------------------------------------------- */
/*                               REFRESH TOKEN                                 */
/* -------------------------------------------------------------------------- */
export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> {
  try {
    const parsed = refreshSchema.parse(req.body);
    const { refreshToken } = parsed;

    if (!refreshToken || typeof refreshToken !== "string") {
      // Should be caught by Zod, but extra defence in case called elsewhere
      throw new APIError("Invalid refresh token", 400, "INVALID_REFRESH_TOKEN");
    }

    // rotateRefreshToken is expected to throw a clear error when token not found / expired.
    // We catch and translate into a 401 to keep API consistent.
    let rotated;
    try {
      rotated = await rotateRefreshToken(refreshToken, req);
    } catch (err: unknown) {
      // If the utility throws a structured APIError we forward its status/code.
      if (err instanceof APIError) return next(err);

      // Common case: token not found or expired -> return 401
      const msg = (err as Error)?.message ?? "Refresh token rotation failed";
      if (/not found|expired|invalid/i.test(msg)) {
        return next(new APIError("Refresh token not found or expired", 401, "REFRESH_NOT_FOUND"));
      }

      // Unknown error — rethrow to be handled by central error handler
      throw err;
    }

    const { refreshTokenPlain, refreshExpiresAt, userId } = rotated;

    // sign a new access token (include only minimal claims here)
    const accessToken = signAccessToken({ sub: userId });

    // audit the rotation
    await addAuditLog({
      eventType: "token_refreshed",
      userId,
      payload: {},
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });

    return send(res, 200, {
      status: "ok",
      data: {
        tokens: {
          accessToken,
          expiresIn: ACCESS_TOKEN_EXPIRES_SECONDS,
          refreshToken: refreshTokenPlain,
          refreshExpiresAt: refreshExpiresAt.toISOString(),
        },
      },
    });
  } catch (err: unknown) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/* -------------------------------------------------------------------------- */
/*                                 LOGOUT                                      */
/* -------------------------------------------------------------------------- */
export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = logoutSchema.parse(req.body);
    const { refreshToken } = parsed;

    await revokeRefreshToken(refreshToken);

    await addAuditLog({
      eventType: "logout",
      payload: {},
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null
    });

    return send(res, 200, { status: "ok" });
  } catch (err) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/* -------------------------------------------------------------------------- */
/*                                   ME                                        */
/* -------------------------------------------------------------------------- */
export async function meHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return send(res, 401, { status: "error", error: { message: "Not authenticated" } });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        fullName: true,
        phoneVerified: true,
        role: true
      }
    });

    return send(res, 200, { status: "ok", data: { user } });
  } catch (err) {
    return next(err);
  }
}
