-- AlterTable
ALTER TABLE "images" ADD COLUMN     "provided_crop_id" UUID;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_provided_crop_id_fkey" FOREIGN KEY ("provided_crop_id") REFERENCES "crops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
