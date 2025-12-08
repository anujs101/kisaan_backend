-- AlterTable
ALTER TABLE "farms" ADD COLUMN     "current_crop_id" UUID;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_current_crop_id_fkey" FOREIGN KEY ("current_crop_id") REFERENCES "crops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
