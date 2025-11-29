-- DropIndex
DROP INDEX "idx_farms_boundary_gist";

-- DropIndex
DROP INDEX "idx_farms_center_gist";

-- AlterTable
ALTER TABLE "farms" ALTER COLUMN "updated_at" DROP DEFAULT;
