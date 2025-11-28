/*
  Warnings:

  - You are about to drop the column `code_hash` on the `phone_otps` table. All the data in the column will be lost.
  - You are about to drop the column `avatar_url` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `provider_id` on the `users` table. All the data in the column will be lost.
  - Made the column `phone` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_userId_fkey";

-- DropIndex
DROP INDEX "idx_user_provider_id";

-- AlterTable
ALTER TABLE "phone_otps" DROP COLUMN "code_hash",
ADD COLUMN     "auth_session_id" UUID,
ADD COLUMN     "message_sid" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "provider_meta" JSONB,
ADD COLUMN     "verification_sid" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "avatar_url",
DROP COLUMN "provider",
DROP COLUMN "provider_id",
ALTER COLUMN "phone" SET NOT NULL;

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "metadata" JSONB,
    "clientNonce" TEXT,
    "request_ip" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_authsession_phone_purpose" ON "auth_sessions"("phone", "purpose");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_otps" ADD CONSTRAINT "phone_otps_auth_session_id_fkey" FOREIGN KEY ("auth_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
