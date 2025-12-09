// src/services/sampling.service.ts
import { prisma } from "@lib/prisma";
import type { Prisma } from "@prisma/client";
import crypto from "crypto";

/**
 * Ensures grid blocks exist for a farm.
 * Uses PostGIS ST_SquareGrid (requires PostGIS 3.1+) to tessellate the farm boundary.
 * * FIXES:
 * 1. Projects to SRID 3857 (meters) so 'resolutionM' creates meter-sized tiles, not degree-sized.
 * 2. performs Intersection/IsEmpty checks in Geometry space to avoid "st_isempty(geography) does not exist".
 * 3. Transforms back to 4326 geography for storage.
 */
export async function ensureFarmGrid(farmId: string, resolutionM: number) {
  // 1. Check if grid exists
  const count = await prisma.gridBlock.count({ where: { farmId } });
  if (count > 0) return;

  // 2. Generate grid using raw SQL
  const sql = `
    INSERT INTO grid_blocks ("id", "farmId", "geom", "grid_resolution_m", "created_at")
    SELECT
      gen_random_uuid(),
      $1::uuid,
      ST_Transform(
        ST_Intersection(
          ST_Transform(f.boundary::geometry, 3857), 
          grid.geom
        ), 
        4326
      )::geography,
      $2::int,
      NOW()
    FROM farms f,
    LATERAL ST_SquareGrid(
      $2::float, 
      ST_Transform(f.boundary::geometry, 3857)
    ) AS grid
    WHERE f.id = $1::uuid
    AND NOT ST_IsEmpty(
      ST_Intersection(
        ST_Transform(f.boundary::geometry, 3857), 
        grid.geom
      )
    )
    ON CONFLICT DO NOTHING;
  `;

  await prisma.$executeRawUnsafe(sql, farmId, resolutionM);
}

/**
 * Selects 4 pseudo-random blocks for a session.
 */
export async function selectSessionBlocks(farmId: string, count = 4) {
  // Simple random selection for now.
  const blocks = await prisma.$queryRawUnsafe(`
    SELECT 
      id, 
      ST_AsGeoJSON(geom)::json as geom, 
      ST_AsGeoJSON(ST_Centroid(geom))::json as centroid
    FROM grid_blocks
    WHERE "farmId" = $1::uuid
    ORDER BY random()
    LIMIT $2::int;
  `, farmId, count) as any[];

  return blocks;
}

/**
 * Creates a new sampling session and assigns blocks.
 */
export async function createSamplingSession(
  userId: string,
  farmId: string,
  resolutionM = 50
) {
  // 1. Ensure grid
  await ensureFarmGrid(farmId, resolutionM);

  // 2. Select blocks
  const blocks = await selectSessionBlocks(farmId, 4);
  if (blocks.length === 0) {
    throw new Error("Farm has no valid grid blocks. Check boundary.");
  }

  // 3. Create Session + Blocks in transaction
  const sessionUuid = crypto.randomUUID();
  
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const session = await tx.samplingSession.create({
      data: {
        sessionUuid,
        userId,
        farmId,
        status: "ACTIVE",
      },
    });

    const blockPromises = blocks.map((b, idx) => {
        return tx.$executeRawUnsafe(`
            INSERT INTO sampling_session_blocks (
                id, "sessionId", "gridBlockId", order_index, status, created_at, 
                grid_block_geom, grid_block_centroid
            ) VALUES (
                gen_random_uuid(), $1::uuid, $2::uuid, $3::int, 'PENDING', NOW(),
                ST_GeomFromGeoJSON($4::text)::geography,
                ST_GeomFromGeoJSON($5::text)::geography
            )
        `, session.id, b.id, idx, JSON.stringify(b.geom), JSON.stringify(b.centroid));
    });

    await Promise.all(blockPromises);
    
    return session;
  });

  return await fetchSessionFull(result.id);
}

export async function fetchSessionFull(sessionId: string) {
    const blocks = await prisma.$queryRawUnsafe(`
        SELECT 
            id, "gridBlockId", status, attempts, "imageId",
            ST_AsGeoJSON(grid_block_centroid)::json as centroid,
            ST_AsGeoJSON(grid_block_geom)::json as geom
        FROM sampling_session_blocks
        WHERE "sessionId" = $1::uuid
        ORDER BY order_index ASC
    `, sessionId) as any[];

    const session = await prisma.samplingSession.findUnique({
        where: { id: sessionId },
        select: { id: true, sessionUuid: true, status: true, farmId: true }
    });

    return { ...session, blocks };
}