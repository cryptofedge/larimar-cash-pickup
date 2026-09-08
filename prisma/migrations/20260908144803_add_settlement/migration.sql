-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'ISSUED', 'RECONCILED', 'PAID', 'DISPUTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "pickup_institutions" ADD COLUMN     "commission_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settlement_currency" CHAR(3) NOT NULL DEFAULT 'DOP';

-- CreateTable
CREATE TABLE "settlement_batches" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "institution_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "payout_count" INTEGER NOT NULL,
    "gross_payout_minor" BIGINT NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "commission_minor" BIGINT NOT NULL,
    "net_payable_minor" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "partner_reported_minor" BIGINT,
    "variance_minor" BIGINT,
    "variance_note" TEXT,
    "reconciled_at" TIMESTAMP(3),
    "reconciled_by" UUID,
    "issued_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "paid_by" UUID,
    "payment_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_lines" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "pickup_event_id" UUID NOT NULL,
    "transaction_id" UUID,
    "transaction_ref" TEXT,
    "location_id" UUID,
    "location_code" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "disbursed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlement_batches_reference_key" ON "settlement_batches"("reference");

-- CreateIndex
CREATE INDEX "settlement_batches_status_period_end_idx" ON "settlement_batches"("status", "period_end");

-- CreateIndex
CREATE INDEX "settlement_batches_institution_id_status_idx" ON "settlement_batches"("institution_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_batches_institution_id_period_start_period_end_key" ON "settlement_batches"("institution_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_lines_pickup_event_id_key" ON "settlement_lines"("pickup_event_id");

-- CreateIndex
CREATE INDEX "settlement_lines_batch_id_idx" ON "settlement_lines"("batch_id");

-- CreateIndex
CREATE INDEX "settlement_lines_transaction_id_idx" ON "settlement_lines"("transaction_id");

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "pickup_institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "settlement_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
