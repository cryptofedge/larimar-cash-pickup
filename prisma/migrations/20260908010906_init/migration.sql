-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('CUSTOMER', 'PICKUP_AGENT', 'PICKUP_MANAGER', 'COMPLIANCE_ANALYST', 'SUPPORT_AGENT', 'FINANCE_ADMIN', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('CREATED', 'CUSTOMER_DETAILS_REQUIRED', 'KYC_REQUIRED', 'KYC_PENDING', 'KYC_APPROVED', 'KYC_REJECTED', 'PAYMENT_PENDING', 'PAYMENT_AUTHORIZED', 'PAYMENT_FAILED', 'COMPLIANCE_REVIEW', 'READY_FOR_PICKUP', 'PARTIALLY_PICKED_UP', 'PICKED_UP', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KycLevel" AS ENUM ('NONE', 'BASIC', 'ENHANCED');

-- CreateEnum
CREATE TYPE "IdentityDocumentType" AS ENUM ('PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'RESIDENCE_PERMIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'REQUIRES_ACTION', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD_DEBIT', 'CARD_CREDIT', 'APPLE_PAY', 'GOOGLE_PAY', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerEventType" AS ENUM ('CUSTOMER_PAYMENT', 'PLATFORM_FEE', 'PROCESSING_FEE', 'FX_CONVERSION', 'PAYOUT_LIABILITY', 'BANK_SETTLEMENT', 'REFUND', 'CHARGEBACK', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ComplianceCaseType" AS ENUM ('KYC_REVIEW', 'SANCTIONS_HIT', 'PEP_MATCH', 'AML_MONITORING', 'SOURCE_OF_FUNDS', 'MANUAL_REVIEW', 'FRAUD_REVIEW');

-- CreateEnum
CREATE TYPE "ComplianceCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'ESCALATED', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FraudAlertType" AS ENUM ('CODE_BRUTE_FORCE', 'VELOCITY_BREACH', 'DEVICE_SHARING', 'GEO_MISMATCH', 'DUPLICATE_TRANSACTION', 'CHARGEBACK_PATTERN', 'AGENT_ANOMALY', 'ACCOUNT_TAKEOVER', 'LIMIT_BREACH');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "PickupCodeStatus" AS ENUM ('ACTIVE', 'LOCKED', 'REDEEMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickupEventType" AS ENUM ('VERIFICATION_ATTEMPT', 'VERIFICATION_SUCCESS', 'VERIFICATION_FAILED', 'IDENTITY_CONFIRMED', 'PAYOUT_APPROVED', 'PAYOUT_REJECTED', 'PAYOUT_ESCALATED', 'PAYOUT_COMPLETED', 'PAYOUT_FAILED', 'CODE_LOCKED');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'TEMPORARILY_CLOSED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChargebackStatus" AS ENUM ('RECEIVED', 'UNDER_REVIEW', 'EVIDENCE_SUBMITTED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED', 'INVALID_SIGNATURE');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('EN', 'ES');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "password_hash" TEXT NOT NULL,
    "password_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "locale" "Locale" NOT NULL DEFAULT 'EN',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" TEXT,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" TEXT,
    "institution_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "phone_e164" TEXT,
    "phone_verified_at" TIMESTAMP(3),
    "residence_country" CHAR(2),
    "travel_country" CHAR(2),
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "previous_id" UUID,
    "mfa_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "idle_expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "label" TEXT,
    "first_seen_ip" TEXT,
    "last_seen_ip" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "request_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "level" "KycLevel" NOT NULL DEFAULT 'NONE',
    "document_type" "IdentityDocumentType",
    "document_last4" TEXT,
    "document_country" CHAR(2),
    "document_expiry" DATE,
    "sanctions_checked" BOOLEAN NOT NULL DEFAULT false,
    "sanctions_hit" BOOLEAN NOT NULL DEFAULT false,
    "pep_hit" BOOLEAN NOT NULL DEFAULT false,
    "rejection_reason" TEXT,
    "reviewed_by" UUID,
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "raw_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedules" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "platform_fee_bps" INTEGER NOT NULL,
    "platform_fee_min_minor" BIGINT NOT NULL,
    "platform_fee_max_minor" BIGINT,
    "fx_spread_bps" INTEGER NOT NULL,
    "processing_fee_bps" INTEGER NOT NULL,
    "processing_fee_fixed_minor" BIGINT NOT NULL,
    "expedited_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "fee_currency" CHAR(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "mid_rate" BIGINT NOT NULL,
    "spread_bps" INTEGER NOT NULL,
    "effective_rate" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "payout_currency" CHAR(3) NOT NULL,
    "payout_amount_minor" BIGINT NOT NULL,
    "funding_currency" CHAR(3) NOT NULL,
    "principal_minor" BIGINT NOT NULL,
    "platform_fee_minor" BIGINT NOT NULL,
    "processing_fee_minor" BIGINT NOT NULL,
    "expedited_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "total_charged_minor" BIGINT NOT NULL,
    "mid_rate" BIGINT NOT NULL,
    "effective_rate" BIGINT NOT NULL,
    "fx_spread_bps" INTEGER NOT NULL,
    "exchange_rate_id" UUID NOT NULL,
    "fee_schedule_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'CREATED',
    "country_code" CHAR(2) NOT NULL,
    "quote_id" UUID NOT NULL,
    "payout_currency" CHAR(3) NOT NULL,
    "payout_amount_minor" BIGINT NOT NULL,
    "paid_out_minor" BIGINT NOT NULL DEFAULT 0,
    "funding_currency" CHAR(3) NOT NULL,
    "total_charged_minor" BIGINT NOT NULL,
    "platform_fee_minor" BIGINT NOT NULL,
    "processing_fee_minor" BIGINT NOT NULL,
    "effective_rate" BIGINT NOT NULL,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "pickup_location_id" UUID,
    "device_id" UUID,
    "created_ip" TEXT,
    "created_country" CHAR(2),
    "expires_at" TIMESTAMP(3),
    "funded_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_events" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "from_status" "TransactionStatus",
    "to_status" "TransactionStatus" NOT NULL,
    "reason" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "captured_minor" BIGINT NOT NULL DEFAULT 0,
    "refunded_minor" BIGINT NOT NULL DEFAULT 0,
    "method_type" "PaymentMethodType",
    "payment_token" TEXT,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "card_bin" TEXT,
    "card_country" CHAR(2),
    "three_ds_result" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "authorized_at" TIMESTAMP(3),
    "captured_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "operation" TEXT NOT NULL,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "provider_raw" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "provider_ref" TEXT,
    "requested_by" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chargebacks" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason_code" TEXT NOT NULL,
    "network_case_ref" TEXT,
    "status" "ChargebackStatus" NOT NULL DEFAULT 'RECEIVED',
    "evidence_due_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chargebacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_institutions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "api_key_id" TEXT,
    "api_secret_enc" TEXT,
    "settlement_account_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pickup_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_locations" (
    "id" UUID NOT NULL,
    "institution_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "postal_code" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "opening_hours" JSONB NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Santo_Domingo',
    "pickup_available" BOOLEAN NOT NULL DEFAULT true,
    "supported_currencies" TEXT[],
    "max_payout_minor" BIGINT NOT NULL,
    "daily_capacity_minor" BIGINT NOT NULL,
    "daily_used_minor" BIGINT NOT NULL DEFAULT 0,
    "capacity_reset_at" TIMESTAMP(3),
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "risk_tier" INTEGER NOT NULL DEFAULT 0,
    "contact_phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pickup_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_location_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID,

    CONSTRAINT "agent_location_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_codes" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "prefix" VARCHAR(4) NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "status" "PickupCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "locked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "redeemed_at" TIMESTAMP(3),
    "redeemed_by" UUID,
    "redeemed_at_location_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_events" (
    "id" UUID NOT NULL,
    "transaction_id" UUID,
    "event_type" "PickupEventType" NOT NULL,
    "agent_id" UUID,
    "institution_id" UUID,
    "location_id" UUID,
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "document_type" "IdentityDocumentType",
    "document_last4" TEXT,
    "verification_result" TEXT,
    "attempted_code_hash" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "normal_balance" "LedgerDirection" NOT NULL,
    "is_custodial" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "event_type" "LedgerEventType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "transaction_id" UUID,
    "reverses_id" UUID,
    "posting_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "ledger_transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_cases" (
    "id" UUID NOT NULL,
    "case_number" TEXT NOT NULL,
    "type" "ComplianceCaseType" NOT NULL,
    "status" "ComplianceCaseStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "subject_user_id" UUID,
    "transaction_id" UUID,
    "assignee_id" UUID,
    "summary" TEXT NOT NULL,
    "findings" TEXT,
    "resolution" TEXT,
    "sar_flagged" BOOLEAN NOT NULL DEFAULT false,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" UUID NOT NULL,
    "transaction_id" UUID,
    "user_id" UUID,
    "rule_key" TEXT NOT NULL,
    "rule_version" INTEGER NOT NULL DEFAULT 1,
    "triggered" BOOLEAN NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "detail" TEXT NOT NULL,
    "signals" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_alerts" (
    "id" UUID NOT NULL,
    "alert_number" TEXT NOT NULL,
    "type" "FraudAlertType" NOT NULL,
    "severity" "RiskLevel" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "transaction_id" UUID,
    "user_id" UUID,
    "description" TEXT NOT NULL,
    "evidence" JSONB,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_policies" (
    "id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "daily_limit_minor" BIGINT NOT NULL,
    "monthly_limit_minor" BIGINT NOT NULL,
    "per_transaction_min_minor" BIGINT NOT NULL,
    "per_transaction_max_minor" BIGINT NOT NULL,
    "limit_currency" CHAR(3) NOT NULL,
    "velocity_window_hours" INTEGER NOT NULL DEFAULT 24,
    "velocity_max_count" INTEGER NOT NULL DEFAULT 5,
    "kyc_required_above_minor" BIGINT NOT NULL,
    "review_score_threshold" INTEGER NOT NULL DEFAULT 60,
    "block_score_threshold" INTEGER NOT NULL DEFAULT 85,
    "high_risk_countries" TEXT[],
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "transaction_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "event_key" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'EN',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "provider_ref" TEXT,
    "failure_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "user_id" UUID,
    "transaction_id" UUID,
    "assignee_id" UUID,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "contact_email" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_roles" TEXT[],
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "signature_valid" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "user_id" UUID,
    "request_hash" TEXT NOT NULL,
    "response_code" INTEGER,
    "response_body" JSONB,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "locked_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_counters" (
    "id" UUID NOT NULL,
    "bucket_key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_institution_id_idx" ON "users"("institution_id");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "user_profiles_phone_e164_idx" ON "user_profiles"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "devices_fingerprint_idx" ON "devices"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_fingerprint_key" ON "devices"("user_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_user_id_code_hash_key" ON "mfa_recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "identity_verifications_user_id_status_idx" ON "identity_verifications"("user_id", "status");

-- CreateIndex
CREATE INDEX "identity_verifications_provider_ref_idx" ON "identity_verifications"("provider_ref");

-- CreateIndex
CREATE INDEX "fee_schedules_country_code_active_idx" ON "fee_schedules"("country_code", "active");

-- CreateIndex
CREATE UNIQUE INDEX "fee_schedules_key_version_key" ON "fee_schedules"("key", "version");

-- CreateIndex
CREATE INDEX "exchange_rates_base_currency_quote_currency_fetched_at_idx" ON "exchange_rates"("base_currency", "quote_currency", "fetched_at");

-- CreateIndex
CREATE INDEX "quotes_expires_at_idx" ON "quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_quote_id_key" ON "transactions"("quote_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_created_at_idx" ON "transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "transactions_risk_level_status_idx" ON "transactions"("risk_level", "status");

-- CreateIndex
CREATE INDEX "transactions_pickup_location_id_status_idx" ON "transactions"("pickup_location_id", "status");

-- CreateIndex
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at");

-- CreateIndex
CREATE INDEX "transaction_events_transaction_id_created_at_idx" ON "transaction_events"("transaction_id", "created_at");

-- CreateIndex
CREATE INDEX "transaction_events_to_status_created_at_idx" ON "transaction_events"("to_status", "created_at");

-- CreateIndex
CREATE INDEX "payments_transaction_id_idx" ON "payments"("transaction_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payments_card_bin_idx" ON "payments"("card_bin");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_ref_key" ON "payments"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "payment_attempts_payment_id_idx" ON "payment_attempts"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_payment_id_attempt_number_key" ON "payment_attempts"("payment_id", "attempt_number");

-- CreateIndex
CREATE INDEX "refunds_transaction_id_idx" ON "refunds"("transaction_id");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE INDEX "chargebacks_transaction_id_idx" ON "chargebacks"("transaction_id");

-- CreateIndex
CREATE INDEX "chargebacks_status_idx" ON "chargebacks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_institutions_code_key" ON "pickup_institutions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_institutions_api_key_id_key" ON "pickup_institutions"("api_key_id");

-- CreateIndex
CREATE INDEX "pickup_institutions_country_code_active_idx" ON "pickup_institutions"("country_code", "active");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_locations_code_key" ON "pickup_locations"("code");

-- CreateIndex
CREATE INDEX "pickup_locations_country_code_city_idx" ON "pickup_locations"("country_code", "city");

-- CreateIndex
CREATE INDEX "pickup_locations_institution_id_status_idx" ON "pickup_locations"("institution_id", "status");

-- CreateIndex
CREATE INDEX "pickup_locations_latitude_longitude_idx" ON "pickup_locations"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "agent_location_assignments_location_id_active_idx" ON "agent_location_assignments"("location_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "agent_location_assignments_user_id_location_id_key" ON "agent_location_assignments"("user_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_codes_transaction_id_key" ON "pickup_codes"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_codes_code_hash_key" ON "pickup_codes"("code_hash");

-- CreateIndex
CREATE INDEX "pickup_codes_status_expires_at_idx" ON "pickup_codes"("status", "expires_at");

-- CreateIndex
CREATE INDEX "pickup_events_transaction_id_created_at_idx" ON "pickup_events"("transaction_id", "created_at");

-- CreateIndex
CREATE INDEX "pickup_events_agent_id_created_at_idx" ON "pickup_events"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "pickup_events_location_id_created_at_idx" ON "pickup_events"("location_id", "created_at");

-- CreateIndex
CREATE INDEX "pickup_events_event_type_created_at_idx" ON "pickup_events"("event_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_type_currency_idx" ON "ledger_accounts"("type", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_reference_key" ON "ledger_transactions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_reverses_id_key" ON "ledger_transactions"("reverses_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_posting_key_key" ON "ledger_transactions"("posting_key");

-- CreateIndex
CREATE INDEX "ledger_transactions_transaction_id_idx" ON "ledger_transactions"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_event_type_occurred_at_idx" ON "ledger_transactions"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_ledger_transaction_id_idx" ON "ledger_entries"("ledger_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_cases_case_number_key" ON "compliance_cases"("case_number");

-- CreateIndex
CREATE INDEX "compliance_cases_status_priority_idx" ON "compliance_cases"("status", "priority");

-- CreateIndex
CREATE INDEX "compliance_cases_transaction_id_idx" ON "compliance_cases"("transaction_id");

-- CreateIndex
CREATE INDEX "compliance_cases_subject_user_id_idx" ON "compliance_cases"("subject_user_id");

-- CreateIndex
CREATE INDEX "risk_events_transaction_id_idx" ON "risk_events"("transaction_id");

-- CreateIndex
CREATE INDEX "risk_events_rule_key_created_at_idx" ON "risk_events"("rule_key", "created_at");

-- CreateIndex
CREATE INDEX "risk_events_level_created_at_idx" ON "risk_events"("level", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_alerts_alert_number_key" ON "fraud_alerts"("alert_number");

-- CreateIndex
CREATE INDEX "fraud_alerts_status_severity_idx" ON "fraud_alerts"("status", "severity");

-- CreateIndex
CREATE INDEX "fraud_alerts_type_created_at_idx" ON "fraud_alerts"("type", "created_at");

-- CreateIndex
CREATE INDEX "risk_policies_country_code_active_idx" ON "risk_policies"("country_code", "active");

-- CreateIndex
CREATE UNIQUE INDEX "risk_policies_country_code_version_key" ON "risk_policies"("country_code", "version");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_event_key_idx" ON "notifications"("event_key");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "support_tickets_status_created_at_idx" ON "support_tickets"("status", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "webhook_events_status_created_at_idx" ON "webhook_events"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_external_id_key" ON "webhook_events"("provider", "external_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE INDEX "rate_limit_counters_expires_at_idx" ON "rate_limit_counters"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_counters_bucket_key_window_start_key" ON "rate_limit_counters"("bucket_key", "window_start");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "pickup_institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_pickup_location_id_fkey" FOREIGN KEY ("pickup_location_id") REFERENCES "pickup_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_locations" ADD CONSTRAINT "pickup_locations_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "pickup_institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_location_assignments" ADD CONSTRAINT "agent_location_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_location_assignments" ADD CONSTRAINT "agent_location_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "pickup_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_codes" ADD CONSTRAINT "pickup_codes_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "pickup_institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "pickup_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_cases" ADD CONSTRAINT "compliance_cases_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_cases" ADD CONSTRAINT "compliance_cases_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_cases" ADD CONSTRAINT "compliance_cases_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
