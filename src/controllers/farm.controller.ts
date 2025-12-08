// src/controllers/farm.controller.ts
import type { Request, Response, NextFunction } from "express";
import axios from "axios";
import { prisma } from "@lib/prisma";
import { ZodError } from "zod";
import { createFarmSchema, updateFarmSchema } from "@validators/farm.schema";
import { fromZodError, APIError } from "@utils/errors";
import { addAuditLog } from "@utils/audit";
import { validateGeoJsonPolygon, ensureRingClosedCoords } from "@utils/geo";

type AuthRequest = Request & { user?: { id: string } };

function sendJson(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

/**
 * Helper: call agro service to register polygon and return its id
 * - Requires AGRO_BASE_URL in env (throws APIError if missing)
 * - Uses AGRO_API_KEY from env if present (Authorization: Bearer)
 * - Expects response.data to contain id in one of: id, agroId, agromonitoringId, agromonitoring_id
 */
async function registerPolygonWithAgro(geojson: Record<string, unknown>): Promise<string> {
  const base = process.env.AGRO_BASE_URL;
  if (!base) {
    throw new APIError("Agro service base URL not configured", 500, "AGRO_CONFIG_MISSING");
  }

  const url = `${base.replace(/\/+$/, "")}/polygons`;
  const apiKey = process.env.AGRO_API_KEY;

  // Change: Pass 'appid' as a query parameter, not a Bearer token
  const params: Record<string, string> = {};
  if (apiKey) {
    params.appid = apiKey; 
  }

  try {
    // Pass 'params' to axios
    const resp = await axios.post(url, geojson, { 
      headers: { "Content-Type": "application/json" },
      params: params, // This creates: /polygons?appid=YOUR_KEY
      timeout: 10_000 
    });

    const data = resp?.data ?? {};
    
    // ... rest of your logic (id extraction) ...
    const agroId: unknown = data.id ?? data.agroId ?? data.agromonitoringId ?? (data?.result && data.result?.id);

    if (typeof agroId === "string" && agroId.length > 0) return agroId;
    if (agroId != null) return String(agroId);

    throw new APIError("Agro service returned unexpected response", 502, "AGRO_INVALID_RESPONSE");
  } catch (err: unknown) {
    // ... your existing error handling ...
    if (axios.isAxiosError(err)) {
       const status = err.response?.status ?? 502;
       const msg = `Agro service call failed: ${err.message}`;
       // Log the actual response body for better debugging
       console.error("Agro Error Body:", JSON.stringify(err.response?.data)); 
       throw new APIError(msg, 502, "AGRO_REQUEST_FAILED", { status, body: err.response?.data ?? null });
    }
    throw err;
  }
}

/**
 * POST /api/farms
 * Create a new farm for the authenticated user.
 * Now requires cropId (validated in Zod). Verifies crop exists before inserting.
 * Calls agro service with polygon before persisting and stores returned agromonitoring_id.
 */
export async function createFarmHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = createFarmSchema.parse(req.body);
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401, "UNAUTHORIZED");

    // Validate crop exists
    const crop = await prisma.crop.findUnique({ where: { id: parsed.cropId }, select: { id: true, name: true } });
    if (!crop) throw new APIError("Specified crop not found", 400, "INVALID_CROP");

    // Ensure coordinates are closed ring
    const coords = ensureRingClosedCoords(parsed.boundary.coordinates);
    if (!Array.isArray(coords) || coords.length === 0) {
      throw new APIError("Boundary coordinates are empty or invalid", 400, "INVALID_BOUNDARY");
    }

    const geojson = { type: "Polygon", coordinates: coords };
    const geojsonText = JSON.stringify(geojson);

    // Validate polygon with PostGIS (ST_IsValid, etc.)
    const { valid, reason } = await validateGeoJsonPolygon(prisma, geojsonText);
    if (!valid) {
      throw new APIError(`Invalid polygon geometry: ${reason ?? "unknown reason"}`, 400, "INVALID_GEOMETRY");
    }

    // Register polygon with agro service and get agromonitoring id
    const agroId = await registerPolygonWithAgro(geojson);
    console.log(`Agro polygon registered with id: ${agroId}`);

    // Insert farm and compute center (atomic using PostGIS). Include current_crop_id and agromonitoring_id.
    const sql = `
      WITH geom AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::json), 4326) AS g
      ), center AS (
        SELECT ST_Centroid(g) AS c FROM geom
      )
      INSERT INTO farms ("userId", name, address, boundary, center, center_lat, center_lon, agromonitoring_id, created_at, updated_at, current_crop_id)
      SELECT $2::uuid, $3::text, $4::text, g, c, ST_Y(c), ST_X(c), $6::text, NOW(), NOW(), $5::uuid
      FROM geom, center
      RETURNING id, "userId", name, address,
                ST_AsGeoJSON(boundary)::json as boundary,
                ST_AsGeoJSON(center)::json as center,
                center_lat, center_lon, agromonitoring_id, current_crop_id, created_at, updated_at;
    `;
    // params: 1=geojsonText, 2=userId, 3=name, 4=address, 5=cropId, 6=agroId
    const raw = await prisma.$queryRawUnsafe(sql, geojsonText, userId, parsed.name, parsed.address ?? null, parsed.cropId, agroId);
    const rows = Array.isArray(raw) ? (raw as any[]) : [];
    const farm = rows[0] ?? null;

    if (!farm) {
      throw new APIError("Failed to create farm", 500, "FARM_CREATE_FAILED");
    }

    await addAuditLog({
      eventType: "farm_created",
      userId,
      relatedId: farm.id,
      payload: {
        name: farm.name ?? null,
        address: farm.address ?? null,
        currentCropId: farm.current_crop_id ?? null,
        cropName: crop.name ?? null,
        agromonitoringId: farm.agromonitoring_id ?? agroId,
      },
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });

    return sendJson(res, 201, { status: "ok", data: { farm } });
  } catch (err: unknown) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/**
 * GET /api/farms
 * List farms belonging to the authenticated user (paginated).
 * Includes current_crop_id and agromonitoring_id in results.
 */
export async function listFarmsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401, "UNAUTHORIZED");

    const page = Math.max(1, Number(req.query.page ?? 1));
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage ?? 20)));
    const offset = (page - 1) * perPage;

    const sql = `
      SELECT id, "userId", name, address,
             ST_AsGeoJSON(boundary)::json AS boundary,
             ST_AsGeoJSON(center)::json AS center,
             center_lat, center_lon, current_crop_id, agromonitoring_id,
             created_at, updated_at
      FROM farms
      WHERE "userId" = $1::uuid
      ORDER BY created_at DESC
      LIMIT $2::int OFFSET $3::int;
    `;
    const raw = await prisma.$queryRawUnsafe(sql, userId, perPage, offset);
    const farms = Array.isArray(raw) ? (raw as any[]) : [];

    return sendJson(res, 200, { status: "ok", data: { farms, page, perPage } });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/farms/:id
 * Return a single farm for the authenticated user.
 * Includes current_crop_id and agromonitoring_id.
 */
export async function getFarmHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401, "UNAUTHORIZED");

    const id = req.params.id;
    if (!id) throw new APIError("Missing farm id", 400, "MISSING_ID");

    const sql = `
      SELECT id, "userId", name, address,
             ST_AsGeoJSON(boundary)::json AS boundary,
             ST_AsGeoJSON(center)::json AS center,
             center_lat, center_lon, current_crop_id, agromonitoring_id,
             created_at, updated_at
      FROM farms
      WHERE id = $1::uuid AND "userId" = $2::uuid
      LIMIT 1;
    `;
    const raw = await prisma.$queryRawUnsafe(sql, id, userId);
    const rows = Array.isArray(raw) ? (raw as any[]) : [];
    const farm = rows[0] ?? null;

    if (!farm) throw new APIError("Not found", 404, "NOT_FOUND");

    return sendJson(res, 200, { status: "ok", data: { farm } });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/farms/:id
 * Update farm (boundary, name, address) — owner only.
 * Crop changes are forbidden via API.
 *
 * NOTE: This handler currently does NOT re-register the polygon with the agro service on boundary update.
 * If you want update to call agro and replace agromonitoring_id when boundary changes, I can add that as a follow-up.
 */
export async function updateFarmHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Defensive: reject attempts to change cropId in the payload even before parsing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((req.body as any) && Object.prototype.hasOwnProperty.call(req.body as any, "cropId")) {
      throw new APIError("Updating cropId on a farm is not allowed", 403, "FORBIDDEN");
    }

    const parsed = updateFarmSchema.parse(req.body);
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401, "UNAUTHORIZED");

    const id = req.params.id;
    if (!id) throw new APIError("Missing farm id", 400, "MISSING_ID");

    // ensure owner exists and belongs to user
    const ownerRaw = await prisma.$queryRawUnsafe(
      `SELECT id FROM farms WHERE id = $1::uuid AND "userId" = $2::uuid LIMIT 1;`,
      id,
      userId
    );
    const ownerRows = Array.isArray(ownerRaw) ? (ownerRaw as any[]) : [];
    if (!ownerRows.length) throw new APIError("Not found or not permitted", 404, "NOT_FOUND");

    // If boundary provided => validate then update boundary + center atomically
    if (parsed.boundary) {
      const coords = ensureRingClosedCoords(parsed.boundary.coordinates);
      if (!Array.isArray(coords) || coords.length === 0) {
        throw new APIError("Boundary coordinates are empty or invalid", 400, "INVALID_BOUNDARY");
      }

      const geojson = { type: "Polygon", coordinates: coords };
      const geojsonText = JSON.stringify(geojson);

      const { valid, reason } = await validateGeoJsonPolygon(prisma, geojsonText);
      if (!valid) throw new APIError(`Invalid polygon geometry: ${reason ?? "unknown reason"}`, 400, "INVALID_GEOMETRY");

      // update boundary and recompute center
      const updateSql = `
        WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::json), 4326) AS g),
             c AS (SELECT ST_Centroid(g) AS c FROM g)
        UPDATE farms
        SET boundary = g.g,
            center = c.c,
            center_lat = ST_Y(c.c),
            center_lon = ST_X(c.c),
            updated_at = NOW()
        FROM g, c
        WHERE id = $2::uuid AND "userId" = $3::uuid
        RETURNING id, "userId", name, address,
                  ST_AsGeoJSON(boundary)::json as boundary,
                  ST_AsGeoJSON(center)::json as center,
                  center_lat, center_lon, current_crop_id, agromonitoring_id, created_at, updated_at;
      `;
      const raw = await prisma.$queryRawUnsafe(updateSql, geojsonText, id, userId);
      const rows = Array.isArray(raw) ? (raw as any[]) : [];
      const farm = rows[0] ?? null;

      if (!farm) throw new APIError("Failed to update farm boundary", 500, "FARM_UPDATE_FAILED");

      // apply scalar updates if present (name/address)
      if (parsed.name !== undefined || parsed.address !== undefined) {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;
        if (parsed.name !== undefined) {
          sets.push(`name = $${idx}::text`);
          params.push(parsed.name);
          idx++;
        }
        if (parsed.address !== undefined) {
          sets.push(`address = $${idx}::text`);
          params.push(parsed.address);
          idx++;
        }
        params.push(id, userId);
        const scalarSql = `UPDATE farms SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${idx}::uuid AND "userId" = $${idx + 1}::uuid RETURNING id, "userId", name, address, ST_AsGeoJSON(boundary)::json as boundary, ST_AsGeoJSON(center)::json as center, center_lat, center_lon, current_crop_id, agromonitoring_id, created_at, updated_at;`;
        const raw2 = await prisma.$queryRawUnsafe(scalarSql, ...params);
        const rows2 = Array.isArray(raw2) ? (raw2 as any[]) : [];
        const farm2 = rows2[0] ?? farm;

        await addAuditLog({
          eventType: "farm_updated",
          userId,
          relatedId: farm2.id,
          payload: { boundaryChanged: true, nameChanged: parsed.name !== undefined, addressChanged: parsed.address !== undefined },
          ip: req.ip,
          userAgent: req.get("user-agent") ?? null,
        });
        return sendJson(res, 200, { status: "ok", data: { farm: farm2 } });
      }

      await addAuditLog({
        eventType: "farm_updated",
        userId,
        relatedId: farm.id,
        payload: { boundaryChanged: true },
        ip: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });

      return sendJson(res, 200, { status: "ok", data: { farm } });
    }

    // No boundary change — only scalar updates
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (parsed.name !== undefined) {
      sets.push(`name = $${idx}::text`);
      params.push(parsed.name);
      idx++;
    }
    if (parsed.address !== undefined) {
      sets.push(`address = $${idx}::text`);
      params.push(parsed.address);
      idx++;
    }

    if (sets.length === 0) {
      return sendJson(res, 200, { status: "ok", data: {} });
    }

    params.push(id, userId);
    const finalSql = `UPDATE farms SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${idx}::uuid AND "userId" = $${idx + 1}::uuid RETURNING id, "userId", name, address, ST_AsGeoJSON(boundary)::json as boundary, ST_AsGeoJSON(center)::json as center, center_lat, center_lon, current_crop_id, agromonitoring_id, created_at, updated_at;`;
    const finalRaw = await prisma.$queryRawUnsafe(finalSql, ...params);
    const finalRows = Array.isArray(finalRaw) ? (finalRaw as any[]) : [];
    const farm = finalRows[0] ?? null;

    if (!farm) throw new APIError("Failed to update farm", 500, "FARM_UPDATE_FAILED");

    await addAuditLog({
      eventType: "farm_updated",
      userId,
      relatedId: farm.id,
      payload: { nameChanged: parsed.name !== undefined, addressChanged: parsed.address !== undefined },
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });

    return sendJson(res, 200, { status: "ok", data: { farm } });
  } catch (err: unknown) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/**
 * DELETE /api/farms/:id
 * Owner-only deletion.
 */
export async function deleteFarmHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401, "UNAUTHORIZED");

    const id = req.params.id;
    if (!id) throw new APIError("Missing farm id", 400, "MISSING_ID");

    const ownerRaw = await prisma.$queryRawUnsafe(`SELECT id FROM farms WHERE id = $1::uuid AND "userId" = $2::uuid LIMIT 1;`, id, userId);
    const ownerRows = Array.isArray(ownerRaw) ? (ownerRaw as any[]) : [];
    if (!ownerRows.length) throw new APIError("Not found or not permitted", 404, "NOT_FOUND");

    await prisma.$executeRawUnsafe(`DELETE FROM farms WHERE id = $1::uuid AND "userId" = $2::uuid;`, id, userId);

    await addAuditLog({
      eventType: "farm_deleted",
      userId,
      relatedId: id,
      payload: {},
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });

    return sendJson(res, 200, { status: "ok", data: { message: "deleted" } });
  } catch (err) {
    return next(err);
  }
}