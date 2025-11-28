// src/utils/jwt.ts
import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "@lib/prisma";

if (!process.env.JWT_ACCESS_SECRET) throw new Error("JWT_ACCESS_SECRET is not set");
if (!process.env.JWT_REFRESH_SECRET) throw new Error("JWT_REFRESH_SECRET is not set");

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET as string;
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET as string;

export const ACCESS_TOKEN_EXPIRES_SECONDS = Number(process.env.ACCESS_TOKEN_EXPIRES_SECONDS ?? 15 * 60); // 15m
export const REFRESH_TOKEN_EXPIRES_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? 30); // 30d

export function signAccessToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: `${ACCESS_TOKEN_EXPIRES_SECONDS}s` });
}

export function verifyAccessToken(token: string) {
  try {
    return jwt.verify(token, ACCESS_TOKEN_SECRET);
  } catch (err) {
    return null;
  }
}

export function generateRefreshTokenPlain(): string {
  return crypto.randomBytes(48).toString("hex"); // 48 bytes -> 96 hex chars
}

/**
 * Hash refresh token using HMAC-SHA256 with server secret. We store this hash in DB.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHmac("sha256", REFRESH_TOKEN_SECRET).update(token).digest("hex");
}

/**
 * Create and persist a refresh token for a user.
 * Returns { refreshTokenPlain, refreshTokenHash, expiresAt }.
 */
export async function createAndStoreRefreshToken(
  userId: string,
  req?: Request,
  tx?: Prisma.TransactionClient,
) {
  const prismaClient = tx || prisma;
  const refreshTokenPlain = generateRefreshTokenPlain();
  const refreshTokenHash = hashRefreshToken(refreshTokenPlain);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

  await prismaClient.refreshToken.create({
    data: {
      userId,
      tokenHash: refreshTokenHash,
      userAgent: (req?.headers["user-agent"] as string) ?? null,
      ip: (req?.ip as string) ?? null,
      expiresAt,
    },
  });

  return { refreshTokenPlain, refreshTokenHash, expiresAt };
}

/**
 * Rotate a refresh token:
 * - verifies incoming plain refresh token by hashing and finding DB row
 * - if found and not expired: delete old row, create+store new refresh token and return new token pair
 * - if not found: throw
 */
export async function rotateRefreshToken(oldRefreshTokenPlain: string, req?: Request) {
  const oldHash = hashRefreshToken(oldRefreshTokenPlain);

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.refreshToken.findFirst({
      where: { tokenHash: oldHash },
    });

    if (!existing) {
      throw new Error("Refresh token not found");
    }

    if (existing.expiresAt < new Date()) {
      // delete expired token
      await tx.refreshToken.delete({ where: { id: existing.id } });
      throw new Error("Refresh token expired");
    }

    // create+store new token first
    const { refreshTokenPlain, expiresAt } = await createAndStoreRefreshToken(
      existing.userId,
      req,
      tx,
    );

    // then delete old token
    await tx.refreshToken.delete({ where: { id: existing.id } });

    return { refreshTokenPlain, refreshExpiresAt: expiresAt, userId: existing.userId };
  });
}

/**
 * Revoke (delete) a single refresh token by plaintext value.
 */
export async function revokeRefreshToken(refreshTokenPlain: string) {
  const hash = hashRefreshToken(refreshTokenPlain);
  await prisma.refreshToken.deleteMany({ where: { tokenHash: hash } });
}

/**
 * Revoke all refresh tokens for a user (useful for "logout all devices" or account recovery)
 */
export async function revokeAllRefreshTokensForUser(userId: string) {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}
