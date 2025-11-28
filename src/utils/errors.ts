// src/utils/errors.ts
import { ZodError } from "zod";

export class APIError extends Error {
  public status: number;
  public code?: string;
  public details?: unknown;

  constructor(message: string, status = 500, code?: string, details?: unknown) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function fromZodError(err: ZodError, message = "Validation failed") {
  return new APIError(message, 400, "VALIDATION_ERROR", {
    issues: err.issues,
  });
}
