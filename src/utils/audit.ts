// src/utils/audit.ts
import { prisma } from "@lib/prisma";

/**
 * Add an audit log record.
 *
 * All fields are optional except eventType. This function
 * never throws an error — failures are swallowed to avoid
 * breaking authentication flows.
 */
export async function addAuditLog({
  eventType,
  userId = null,
  relatedId = null,
  payload = null,
  ip = null,
  userAgent = null,
}: {
  eventType: string;
  userId?: string | null;
  relatedId?: string | null;
  payload?: any | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        eventType,
        userId,
        relatedId,
        payload,
        ip,
        userAgent,
      },
    });
  } catch (err) {
    // NEVER throw — audit failures must not block login/OTP flows.
    console.error("AuditLog error:", err);
  }
}
