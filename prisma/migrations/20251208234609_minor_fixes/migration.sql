/*
  Warnings:

  - You are about to drop the column `agromonitoring_poly_id` on the `damage_reports` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "idx_damage_reports_polyid";

-- AlterTable
ALTER TABLE "damage_reports" DROP COLUMN "agromonitoring_poly_id",
ADD COLUMN     "agromonitoring_id" TEXT;

-- AlterTable
ALTER TABLE "farms" ADD COLUMN     "agromonitoring_id" TEXT,
ADD COLUMN     "calculated_yield" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "idx_damage_reports_id" ON "damage_reports"("agromonitoring_id");
