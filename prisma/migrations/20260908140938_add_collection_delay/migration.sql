-- AlterTable
ALTER TABLE "pickup_codes" ADD COLUMN     "collectable_from" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "risk_policies" ADD COLUMN     "collection_delay_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "collection_delay_risk_threshold" INTEGER NOT NULL DEFAULT 30;
