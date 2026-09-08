/**
 * Request schemas.
 *
 * These are the single source of truth for what the API accepts: the route
 * handlers parse with them, and the OpenAPI document is generated from them, so
 * the documentation cannot drift from the implementation.
 *
 * `.strict()` everywhere is deliberate. An unknown field is rejected rather than
 * ignored, which stops a client from smuggling `{ amount: 1, status: 'PICKED_UP' }`
 * past a handler that happens to spread its input somewhere.
 */

import { z } from 'zod';
import { LOCALES } from '@/i18n/config';
import { TRANSACTION_STATUSES } from '@/lib/domain/transaction-state';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

/**
 * Password policy: length over composition rules.
 *
 * NIST SP 800-63B guidance is that length and a breach-list check beat forced
 * symbol classes, which mostly produce `Password1!`. The obvious-pattern check
 * below is a stand-in for a real breached-password service in production.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200, 'That password is too long')
  .refine((value) => /[a-zA-Z]/.test(value), 'Include at least one letter')
  .refine((value) => /\d/.test(value), 'Include at least one number')
  .refine(
    (value) => !/^(password|12345678|qwerty|letmein|welcome)/i.test(value),
    'That password is too common',
  );

/** Minor units arrive as a decimal string; a JS number would lose precision. */
export const minorUnitsSchema = z
  .string()
  .regex(/^\d{1,18}$/, 'Amount must be a whole number of minor units');

export const currencySchema = z.string().length(3).regex(/^[A-Za-z]{3}$/).transform((v) => v.toUpperCase());
export const countrySchema = z.string().length(2).regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase());
export const uuidSchema = z.string().uuid();
export const localeSchema = z.enum(LOCALES);

export const pickupCodeSchema = z
  .string()
  .trim()
  .min(8)
  .max(20)
  .regex(/^[A-Za-z0-9\s_-]+$/, 'That is not a valid pickup code');

export const documentTypeSchema = z.enum([
  'PASSPORT',
  'NATIONAL_ID',
  'DRIVERS_LICENSE',
  'RESIDENCE_PERMIT',
]);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    locale: localeSchema.optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms to create an account' }),
    }),
    deviceFingerprint: z.string().max(200).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(200),
    totpCode: z.string().regex(/^\d{6}$/).optional(),
    deviceFingerprint: z.string().max(200).optional(),
  })
  .strict();

export const requestPasswordResetSchema = z.object({ email: emailSchema }).strict();

export const completePasswordResetSchema = z
  .object({ token: z.string().min(20).max(200), password: passwordSchema })
  .strict();

// ---------------------------------------------------------------------------
// Quotes and transactions
// ---------------------------------------------------------------------------

export const quoteRequestSchema = z
  .object({
    payoutAmountMinor: minorUnitsSchema,
    payoutCurrency: currencySchema.default('DOP'),
    fundingCurrency: currencySchema.default('USD'),
    countryCode: countrySchema.default('DO'),
    expedited: z.boolean().default(false),
  })
  .strict();

/**
 * Note what a client may NOT send: no rate, no fee, no total, no status.
 * Every one of those is computed server-side from stored configuration.
 */
export const createTransactionSchema = z
  .object({
    payoutAmountMinor: minorUnitsSchema,
    countryCode: countrySchema.default('DO'),
    fundingCurrency: currencySchema.default('USD'),
    pickupLocationId: uuidSchema.optional(),
    expedited: z.boolean().default(false),
    deviceFingerprint: z.string().max(200).optional(),
  })
  .strict();

export const cancelTransactionSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const listTransactionsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: uuidSchema.optional(),
    status: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((s) => s.trim())
              .filter((s): s is (typeof TRANSACTION_STATUSES)[number] =>
                (TRANSACTION_STATUSES as readonly string[]).includes(s),
              )
          : undefined,
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export const createPaymentIntentSchema = z.object({}).strict();

export const confirmPaymentSchema = z
  .object({
    /**
     * An opaque provider token. The regex is a hard boundary: anything that
     * looks like a card number is rejected before it can reach a log, a
     * database, or a provider call.
     */
    paymentToken: z
      .string()
      .min(8)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/, 'Invalid payment token')
      .refine(
        (value) => !/^\d{12,19}$/.test(value.replace(/[\s-]/g, '')),
        'Card numbers must never be sent to this endpoint',
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

export const submitKycSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    documentType: documentTypeSchema,
    documentNumber: z.string().trim().min(4).max(50),
    documentCountry: countrySchema,
    residenceCountry: countrySchema,
    transactionId: uuidSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Pickup (agent surface)
// ---------------------------------------------------------------------------

export const verifyPickupSchema = z
  .object({
    code: pickupCodeSchema,
    secret: z.string().regex(/^[0-9a-f]{32}$/).optional(),
    locationId: uuidSchema,
  })
  .strict();

export const redeemPickupSchema = z
  .object({
    code: pickupCodeSchema,
    locationId: uuidSchema,
    documentType: documentTypeSchema,
    documentLast4: z.string().regex(/^[A-Za-z0-9*]{4}$/),
    amountMinor: minorUnitsSchema,
    identityConfirmed: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm you verified the customer identity' }),
    }),
  })
  .strict();

export const rejectPickupSchema = z
  .object({
    transactionId: uuidSchema,
    locationId: uuidSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const escalatePickupSchema = rejectPickupSchema;

export const listLocationsSchema = z
  .object({
    countryCode: countrySchema.optional(),
    city: z.string().trim().max(100).optional(),
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

// ---------------------------------------------------------------------------
// Compliance and admin
// ---------------------------------------------------------------------------

export const complianceReviewSchema = z
  .object({
    transactionId: uuidSchema,
    action: z.enum(['HOLD', 'RELEASE', 'REJECT']),
    reason: z.string().trim().min(3).max(1000),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  })
  .strict();

export const refundSchema = z
  .object({
    transactionId: uuidSchema,
    amountMinor: minorUnitsSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const adminSearchSchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.string().max(400).optional(),
    riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    locationId: uuidSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const updatePricingSchema = z
  .object({
    countryCode: countrySchema,
    platformFeeBps: z.number().int().min(0).max(2000),
    platformFeeMinMinor: minorUnitsSchema,
    fxSpreadBps: z.number().int().min(0).max(2000),
    processingFeeBps: z.number().int().min(0).max(2000),
    processingFeeFixedMinor: minorUnitsSchema,
    expeditedFeeMinor: minorUnitsSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export const supportTicketSchema = z
  .object({
    subject: z.string().trim().min(3).max(200),
    body: z.string().trim().min(10).max(5000),
    category: z.enum(['TRANSACTION', 'PICKUP', 'ACCOUNT', 'OTHER']),
    contactEmail: emailSchema,
    transactionId: uuidSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const paymentWebhookSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'payment.authorized',
    'payment.captured',
    'payment.failed',
    'payment.refunded',
    'payment.chargeback',
  ]),
  providerRef: z.string().min(1),
  amountMinor: z.union([z.string(), z.number()]),
  currency: currencySchema,
  occurredAt: z.string(),
  data: z.record(z.unknown()).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type VerifyPickupInput = z.infer<typeof verifyPickupSchema>;
export type RedeemPickupInput = z.infer<typeof redeemPickupSchema>;
export type SubmitKycInput = z.infer<typeof submitKycSchema>;

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export const generateSettlementSchema = z
  .object({
    institutionId: uuidSchema,
    /** Half-open [start, end). Omit both to settle the previous whole UTC day. */
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
  })
  .strict();

export const settlementActionSchema = z
  .object({
    batchId: uuidSchema,
    action: z.enum(['ISSUE', 'RECONCILE', 'PAY', 'CANCEL']),
    /** RECONCILE: the partner's own total, in integer minor units. */
    partnerReportedMinor: minorUnitsSchema.optional(),
    /** RECONCILE: required to accept a non-zero variance. */
    varianceNote: z.string().trim().min(3).max(1000).optional(),
    /** PAY: the bank transfer reference. */
    paymentReference: z.string().trim().min(3).max(200).optional(),
    /** CANCEL: why. */
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine(
    (value) => value.action !== 'RECONCILE' || value.partnerReportedMinor !== undefined,
    { message: 'partnerReportedMinor is required to reconcile', path: ['partnerReportedMinor'] },
  )
  .refine(
    (value) => value.action !== 'PAY' || value.paymentReference !== undefined,
    { message: 'paymentReference is required to mark a batch paid', path: ['paymentReference'] },
  )
  .refine(
    (value) => value.action !== 'CANCEL' || value.reason !== undefined,
    { message: 'reason is required to cancel a batch', path: ['reason'] },
  );

export const listSettlementsSchema = z
  .object({
    institutionId: uuidSchema.optional(),
    status: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
