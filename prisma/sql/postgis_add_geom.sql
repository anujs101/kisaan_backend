-- prisma/sql/postgis_add_geom.sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- only if you use gen_random_uuid()

ALTER TABLE IF EXISTS images
  ADD COLUMN IF NOT EXISTS geom geography(Point,4326);

-- Optionally backfill geom from upload coords (if you want)
UPDATE images
SET geom = ST_SetSRID(ST_MakePoint(upload_lon, upload_lat), 4326)
WHERE geom IS NULL AND upload_lon IS NOT NULL AND upload_lat IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_images_geom_gist
  ON images USING GIST (geom);
