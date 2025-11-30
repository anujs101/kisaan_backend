-- Ensure PostGIS is enabled (idempotent)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Alter images: add farmId
ALTER TABLE "images" 
ADD COLUMN "farmId" UUID;

-- Create farms table
CREATE TABLE "farms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "name" TEXT,
    "address" TEXT,

    -- PostGIS geometry
    "boundary" geography(Polygon,4326),
    "center"   geography(Point,4326),

    -- Non-spatial fallback fields (optional)
    "center_lat" DOUBLE PRECISION,
    "center_lon" DOUBLE PRECISION,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- Index for normal filtering
CREATE INDEX "idx_farms_user_id" ON "farms"("userId");

-- PostGIS spatial indexes
CREATE INDEX "idx_farms_boundary_gist" ON "farms" USING GIST ("boundary");
CREATE INDEX "idx_farms_center_gist" ON "farms" USING GIST ("center");

-- Add FK to users
ALTER TABLE "farms"
ADD CONSTRAINT "farms_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- Add FK to images
ALTER TABLE "images"
ADD CONSTRAINT "images_farmId_fkey"
FOREIGN KEY ("farmId") REFERENCES "farms"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;