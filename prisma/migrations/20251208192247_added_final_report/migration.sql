/*
  Warnings:

  - You are about to drop the column `active` on the `crops` table. All the data in the column will be lost.
  - You are about to drop the column `seasons` on the `crops` table. All the data in the column will be lost.
  - You are about to drop the column `agromonitoring_id` on the `farms` table. All the data in the column will be lost.
  - You are about to drop the column `current_crop_id` on the `farms` table. All the data in the column will be lost.
  - You are about to drop the column `block` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `detected_crop_id` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `detected_stage_id` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `district` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `provided_crop_id` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `quality_score` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `uploadId` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `upload_lat` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `upload_lon` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `upload_timestamp` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `verification_distance_m` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `verification_reason` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `verification_status` on the `images` table. All the data in the column will be lost.
  - You are about to drop the column `village` on the `images` table. All the data in the column will be lost.
  - The `role` column on the `users` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `auth_sessions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `damage_case_images` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `damage_cases` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `damage_categories` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `growth_stages` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `image_analytics` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `image_reviews` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `phone_otps` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `refresh_tokens` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FARMER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "DamageStatus" AS ENUM ('PENDING', 'VERIFIED_DAMAGE', 'NO_DAMAGE_DETECTED', 'NEGLIGIBLE_DAMAGE', 'INCONCLUSIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "DocVerificationStatus" AS ENUM ('NOT_REVIEWED', 'APPROVED', 'REJECTED', 'FLAGGED', 'NEEDS_MORE_INFO');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "damage_case_images" DROP CONSTRAINT "damage_case_images_damage_case_id_fkey";

-- DropForeignKey
ALTER TABLE "damage_case_images" DROP CONSTRAINT "damage_case_images_imageId_fkey";

-- DropForeignKey
ALTER TABLE "damage_cases" DROP CONSTRAINT "damage_cases_created_by_fkey";

-- DropForeignKey
ALTER TABLE "damage_cases" DROP CONSTRAINT "damage_cases_cropId_fkey";

-- DropForeignKey
ALTER TABLE "damage_cases" DROP CONSTRAINT "damage_cases_farmId_fkey";

-- DropForeignKey
ALTER TABLE "farms" DROP CONSTRAINT "farms_current_crop_id_fkey";

-- DropForeignKey
ALTER TABLE "growth_stages" DROP CONSTRAINT "growth_stages_cropId_fkey";

-- DropForeignKey
ALTER TABLE "image_analytics" DROP CONSTRAINT "image_analytics_imageId_fkey";

-- DropForeignKey
ALTER TABLE "image_reviews" DROP CONSTRAINT "image_reviews_imageId_fkey";

-- DropForeignKey
ALTER TABLE "image_reviews" DROP CONSTRAINT "image_reviews_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "images" DROP CONSTRAINT "images_detected_crop_id_fkey";

-- DropForeignKey
ALTER TABLE "images" DROP CONSTRAINT "images_detected_stage_id_fkey";

-- DropForeignKey
ALTER TABLE "images" DROP CONSTRAINT "images_provided_crop_id_fkey";

-- DropForeignKey
ALTER TABLE "images" DROP CONSTRAINT "images_uploadId_fkey";

-- DropForeignKey
ALTER TABLE "phone_otps" DROP CONSTRAINT "phone_otps_auth_session_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_userId_fkey";

-- DropIndex
DROP INDEX "idx_images_detected_crop";

-- DropIndex
DROP INDEX "idx_images_state_district";

-- DropIndex
DROP INDEX "idx_images_status_created_at";

-- AlterTable
ALTER TABLE "crops" DROP COLUMN "active",
DROP COLUMN "seasons";

-- AlterTable
ALTER TABLE "farms" DROP COLUMN "agromonitoring_id",
DROP COLUMN "current_crop_id",
ADD COLUMN     "area_ha" DOUBLE PRECISION,
ADD COLUMN     "estimated_yield" DOUBLE PRECISION,
ADD COLUMN     "grid_resolution_m" INTEGER;

-- AlterTable
ALTER TABLE "images" DROP COLUMN "block",
DROP COLUMN "detected_crop_id",
DROP COLUMN "detected_stage_id",
DROP COLUMN "district",
DROP COLUMN "provided_crop_id",
DROP COLUMN "quality_score",
DROP COLUMN "state",
DROP COLUMN "uploadId",
DROP COLUMN "upload_lat",
DROP COLUMN "upload_lon",
DROP COLUMN "upload_timestamp",
DROP COLUMN "verification_distance_m",
DROP COLUMN "verification_reason",
DROP COLUMN "verification_status",
DROP COLUMN "village",
ADD COLUMN     "damage_report_id" UUID,
ADD COLUMN     "filesize" BIGINT,
ADD COLUMN     "final_report_id" UUID,
ADD COLUMN     "grid_block_id" UUID,
ADD COLUMN     "upload_id" UUID,
ADD COLUMN     "weekly_report_id" UUID,
ALTER COLUMN "storage_url" DROP NOT NULL,
ALTER COLUMN "exif" DROP NOT NULL,
ALTER COLUMN "geom" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "role",
ADD COLUMN     "role" "Role" DEFAULT 'FARMER';

-- DropTable
DROP TABLE "auth_sessions";

-- DropTable
DROP TABLE "damage_case_images";

-- DropTable
DROP TABLE "damage_cases";

-- DropTable
DROP TABLE "damage_categories";

-- DropTable
DROP TABLE "growth_stages";

-- DropTable
DROP TABLE "image_analytics";

-- DropTable
DROP TABLE "image_reviews";

-- DropTable
DROP TABLE "phone_otps";

-- DropTable
DROP TABLE "refresh_tokens";

-- DropEnum
DROP TYPE "ReviewStatus";

-- DropEnum
DROP TYPE "VerificationStatus";

-- CreateTable
CREATE TABLE "grid_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "farmId" UUID NOT NULL,
    "geom" geography(Polygon,4326) NOT NULL,
    "grid_resolution_m" INTEGER,
    "row_index" INTEGER,
    "col_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grid_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_uuid" TEXT NOT NULL,
    "userId" UUID,
    "farmId" UUID,
    "plan" JSONB,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sampling_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_session_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" UUID NOT NULL,
    "gridBlockId" UUID NOT NULL,
    "grid_block_geom" geography(Polygon,4326),
    "grid_block_centroid" geography(Point,4326),
    "order_index" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "assigned_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "imageId" UUID,
    "capture_lat" DOUBLE PRECISION,
    "capture_lon" DOUBLE PRECISION,
    "capture_timestamp" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sampling_session_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "farmId" UUID,
    "userId" UUID,
    "agromonitoring_poly_id" TEXT,
    "claim_timestamp" TIMESTAMP(3),
    "damage_status" "DamageStatus" NOT NULL DEFAULT 'PENDING',
    "damage_percentage" DOUBLE PRECISION,
    "baseline_ndvi_avg" DOUBLE PRECISION,
    "current_ndvi_avg" DOUBLE PRECISION,
    "satellite_images_analyzed" INTEGER,
    "doc_verification" "DocVerificationStatus",
    "processed_at" TIMESTAMP(3),
    "processed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ndvi_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "damage_report_id" UUID,
    "raw_payload" JSONB,
    "start_unix" INTEGER,
    "end_unix" INTEGER,
    "image_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ndvi_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "farmId" UUID,
    "userId" UUID,
    "health_score" INTEGER,
    "predicted_growth_stage" TEXT,
    "farmer_growth_stage" TEXT,
    "recommendation" TEXT,
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "farmId" UUID,
    "userId" UUID,
    "harvest_date" TIMESTAMP(3),
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cce" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,

    CONSTRAINT "cce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_grid_blocks_farm_id" ON "grid_blocks"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "sampling_sessions_session_uuid_key" ON "sampling_sessions"("session_uuid");

-- CreateIndex
CREATE INDEX "idx_sampling_sessions_uuid" ON "sampling_sessions"("session_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sampling_session_blocks_imageId_key" ON "sampling_session_blocks"("imageId");

-- CreateIndex
CREATE INDEX "idx_session_blocks_session_id" ON "sampling_session_blocks"("sessionId");

-- CreateIndex
CREATE INDEX "idx_session_blocks_gridblock_id" ON "sampling_session_blocks"("gridBlockId");

-- CreateIndex
CREATE INDEX "idx_damage_reports_polyid" ON "damage_reports"("agromonitoring_poly_id");

-- CreateIndex
CREATE INDEX "idx_damage_reports_status_created" ON "damage_reports"("damage_status", "created_at");

-- CreateIndex
CREATE INDEX "idx_ndvi_histories_report_id" ON "ndvi_histories"("damage_report_id");

-- CreateIndex
CREATE INDEX "idx_weekly_reports_farm" ON "weekly_reports"("farmId");

-- CreateIndex
CREATE INDEX "idx_final_reports_harvest_date" ON "final_reports"("harvest_date");

-- CreateIndex
CREATE UNIQUE INDEX "cce_userId_key" ON "cce"("userId");

-- CreateIndex
CREATE INDEX "idx_images_created_at" ON "images"("created_at");

-- CreateIndex
CREATE INDEX "idx_images_grid_block_id" ON "images"("grid_block_id");

-- AddForeignKey
ALTER TABLE "grid_blocks" ADD CONSTRAINT "grid_blocks_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_damage_report_id_fkey" FOREIGN KEY ("damage_report_id") REFERENCES "damage_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_weekly_report_id_fkey" FOREIGN KEY ("weekly_report_id") REFERENCES "weekly_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_final_report_id_fkey" FOREIGN KEY ("final_report_id") REFERENCES "final_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_sessions" ADD CONSTRAINT "sampling_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_sessions" ADD CONSTRAINT "sampling_sessions_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_session_blocks" ADD CONSTRAINT "sampling_session_blocks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sampling_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_session_blocks" ADD CONSTRAINT "sampling_session_blocks_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ndvi_histories" ADD CONSTRAINT "ndvi_histories_damage_report_id_fkey" FOREIGN KEY ("damage_report_id") REFERENCES "damage_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_reports" ADD CONSTRAINT "final_reports_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_reports" ADD CONSTRAINT "final_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cce" ADD CONSTRAINT "cce_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
