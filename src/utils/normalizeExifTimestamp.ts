/**
 * Convert EXIF DateTime or DateTimeOriginal ("2025:11:30 04:11:56")
 * into a valid ISO string ("2025-11-30T04:11:56Z")
 *
 * Throws error if irreversible.
 */
// src/utils/normalizeExifTimestamp.ts
export function normalizeExifTimestamp(raw: unknown): Date {
  if (raw === undefined || raw === null) {
    throw new Error("normalizeExifTimestamp: missing value");
  }

  // Already a valid Date
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) {
      throw new Error("normalizeExifTimestamp: Date object is invalid");
    }
    return raw;
  }

  const s = String(raw).trim();

  // EXIF common format: "YYYY:MM:DD HH:mm:ss" (note colons in date part)
  const exifRegex = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
  const m = s.match(exifRegex);
  if (m) {
    const [, y, mo, d, hh, mm, ss] = m;
    // produce ISO + Z (we assume UTC — if you want local offset, you'd need to derive it)
    const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}Z`;
    const dt = new Date(iso);
    if (!isNaN(dt.getTime())) return dt;
    throw new Error(`normalizeExifTimestamp: could not parse ISO produced from EXIF: ${iso}`);
  }

  // fallback: try native Date parse for ISO-like inputs
  const dt2 = new Date(s);
  if (!isNaN(dt2.getTime())) return dt2;

  // Not parseable
  throw new Error(`normalizeExifTimestamp: unrecognized timestamp format: ${s}`);
}
