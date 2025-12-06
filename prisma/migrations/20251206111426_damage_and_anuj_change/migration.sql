/*
  Warnings:

  - Added the required column `current_crop_id` to the `farms` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "damage_cases" ADD COLUMN     "damage_type" TEXT,
ADD COLUMN     "farmId" UUID,
ADD COLUMN     "report_details" JSONB;

-- AlterTable
ALTER TABLE "farms" ADD COLUMN     "agromonitoring_id" TEXT,
ADD COLUMN     "current_crop_id" UUID NOT NULL;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_current_crop_id_fkey" FOREIGN KEY ("current_crop_id") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_cases" ADD CONSTRAINT "damage_cases_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
