-- AlterTable
ALTER TABLE "damage_reports" ADD COLUMN     "ai_damage_type" TEXT;

-- AlterTable
ALTER TABLE "images" ADD COLUMN     "ai_analysis" JSONB;

-- AlterTable
ALTER TABLE "weekly_reports" ADD COLUMN     "ai_disease_summary" JSONB;
