-- Ensure PostGIS is available
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add GIST index for farm boundary polygon
CREATE INDEX IF NOT EXISTS idx_farms_boundary_gist
ON farms USING GIST (boundary);

-- Add GIST index for farm center point
CREATE INDEX IF NOT EXISTS idx_farms_center_gist
ON farms USING GIST (center);