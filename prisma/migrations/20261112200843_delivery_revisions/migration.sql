-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SUBMITTED', 'REVISION_REQUESTED');

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "reviewedAt" TIMESTAMPTZ(6),
ADD COLUMN     "revisionNote" TEXT,
ADD COLUMN     "status" "DeliveryStatus" NOT NULL DEFAULT 'SUBMITTED';
