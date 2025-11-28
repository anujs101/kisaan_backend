-- ensure extensions exist before any geography columns
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology; -- optional
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'PROCESSING');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'LOW_CONFIDENCE', 'UNVERIFIED', 'FLAGGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_MORE_INFO');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT,
    "full_name" TEXT,
    "role" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "local_upload_id" UUID NOT NULL,
    "filename" TEXT,
    "filesize" BIGINT,
    "has_capture_coords" BOOLEAN,
    "signed_params" JSONB,
    "cloudinary_public_id" TEXT,
    "upload_status" "UploadStatus",
    "device_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "uploadId" UUID,
    "local_upload_id" UUID NOT NULL,
    "cloudinary_public_id" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "exif" JSONB NOT NULL,
    "exif_lat" DOUBLE PRECISION,
    "exif_lon" DOUBLE PRECISION,
    "exif_timestamp" TIMESTAMP(3),
    "capture_lat" DOUBLE PRECISION,
    "capture_lon" DOUBLE PRECISION,
    "capture_timestamp" TIMESTAMP(3),
    "upload_lat" DOUBLE PRECISION,
    "upload_lon" DOUBLE PRECISION,
    "upload_timestamp" TIMESTAMP(3),
    "state" TEXT,
    "district" TEXT,
    "block" TEXT,
    "village" TEXT,
    "detected_crop_id" UUID,
    "detected_stage_id" UUID,
    "quality_score" DOUBLE PRECISION,
    "image_hash" TEXT,
    "geom" geography(Point,4326) NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_reason" TEXT,
    "verification_distance_m" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_analytics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "imageId" UUID NOT NULL,
    "model_name" TEXT,
    "model_version" TEXT,
    "results" JSONB NOT NULL,
    "quality_score" DOUBLE PRECISION,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "imageId" UUID NOT NULL,
    "reviewerId" UUID,
    "status" "ReviewStatus",
    "reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT,
    "seasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cropId" UUID NOT NULL,
    "name" TEXT,
    "stage_order" INTEGER,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT,
    "code" TEXT,
    "default_severity" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_by" UUID,
    "region_state" TEXT,
    "region_district" TEXT,
    "summary" TEXT,
    "cropId" UUID,
    "severity" TEXT,
    "status" TEXT DEFAULT 'open',
    "estimated_area_ha" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damage_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_case_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "damage_case_id" UUID NOT NULL,
    "imageId" UUID NOT NULL,

    CONSTRAINT "damage_case_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "userId" UUID,
    "related_id" UUID,
    "payload" JSONB,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_uploads_user_id" ON "uploads"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ux_uploads_local_upload_id" ON "uploads"("local_upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "images_image_hash_key" ON "images"("image_hash");

-- CreateIndex
CREATE INDEX "idx_images_status_created_at" ON "images"("verification_status", "created_at");

-- CreateIndex
CREATE INDEX "idx_images_state_district" ON "images"("state", "district");

-- CreateIndex
CREATE INDEX "idx_images_detected_crop" ON "images"("detected_crop_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_images_local_upload_id" ON "images"("local_upload_id");

-- CreateIndex
CREATE INDEX "idx_image_analytics_image_id" ON "image_analytics"("imageId");

-- CreateIndex
CREATE INDEX "idx_image_analytics_processed_at" ON "image_analytics"("processed_at");

-- CreateIndex
CREATE INDEX "idx_image_reviews_image_id" ON "image_reviews"("imageId");

-- CreateIndex
CREATE INDEX "idx_image_reviews_status" ON "image_reviews"("status");

-- CreateIndex
CREATE UNIQUE INDEX "crops_code_key" ON "crops"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_growth_stage_crop_order" ON "growth_stages"("cropId", "stage_order");

-- CreateIndex
CREATE UNIQUE INDEX "damage_categories_code_key" ON "damage_categories"("code");

-- CreateIndex
CREATE INDEX "idx_damage_cases_region" ON "damage_cases"("region_state", "region_district");

-- CreateIndex
CREATE INDEX "idx_damage_cases_status" ON "damage_cases"("status");

-- CreateIndex
CREATE INDEX "idx_damage_case_images_case" ON "damage_case_images"("damage_case_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_related" ON "audit_logs"("related_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_time" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_detected_crop_id_fkey" FOREIGN KEY ("detected_crop_id") REFERENCES "crops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_detected_stage_id_fkey" FOREIGN KEY ("detected_stage_id") REFERENCES "growth_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_analytics" ADD CONSTRAINT "image_analytics_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_reviews" ADD CONSTRAINT "image_reviews_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_reviews" ADD CONSTRAINT "image_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_stages" ADD CONSTRAINT "growth_stages_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_cases" ADD CONSTRAINT "damage_cases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_cases" ADD CONSTRAINT "damage_cases_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_case_images" ADD CONSTRAINT "damage_case_images_damage_case_id_fkey" FOREIGN KEY ("damage_case_id") REFERENCES "damage_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_case_images" ADD CONSTRAINT "damage_case_images_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
