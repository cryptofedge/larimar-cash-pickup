/**
 * Transaction service.
 *
 * The only place a transaction is created and the only place its status changes.
 * Both operations run inside a database transaction that also writes the event
 * stream, the risk record, and the audit entry — so those can never drift apart
 * from the status they describe.
 */

import type { Prisma, TransactionStatus as PrismaStatus } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../db';
import { env } from '../env';
import { DomainError } from '@/lib/domain/errors';
import { getEnabledCountry } from '@/lib/domain/countries';
import { fromMinor } from '@/lib/domain/money';
import {
  type ActorType,
  type TransactionStatus,
  assertTransition,
  isRedeemable,
} from '@/lib/domain/transaction-state';
import {
  type RiskAssessment,
  type RiskContext,
  type RiskPolicyConfig,
  evaluateRisk,
} from '@/lib/domain/risk';
import { createQuote, consumeQuote, quoteToMoney } from './pricing';
import { writeAudit } from './audit';
import { enqueueNotification } from './notification';
import { generateReference } from '../auth/crypto';
import { getSanctionsProvider } from '../providers/kyc';

// ---------------------------------------------------------------------------
// Risk policy
// ---------------------------------------------------------------------------

export async function getActiveRiskPolicy(
  countryCode: string,
  client: PrismaTransactionClient = prisma,
): Promise<RiskPolicyConfig> {
  const row = await client.riskPolicy.findFirst({
    where: { countryCode, active: true },
    orderBy: { version: 'desc' },
  });

  if (!row) {
    throw new DomainError(
      'CONFIGURATION_ERROR',
      `No active risk policy for ${countryCode}. Seed the database first.`,
    );
  }

  return {
    countryCode: row.countryCode,
    version: row.version,
    dailyLimitMinor: row.dailyLimitMinor,
    monthlyLimitMinor: row.monthlyLimitMinor,
    perTransactionMinMinor: row.perTransactionMinMinor,
    perTransactionMaxMinor: row.perTransactionMaxMinor,
    limitCurrency: row.limitCurrency,
    velocityWindowHours: row.velocityWindowHours,
    velocityMaxCount: row.velocityMaxCount,
    kycRequiredAboveMinor: row.kycRequiredAboveMinor,
    reviewScoreThreshold: row.reviewScoreThreshold,
    blockScoreThreshold: row.blockScoreThreshold,
    highRiskCountries: row.highRiskCountries,
  };
}

/** Statuses that consume a customer's limits: funded, or on the way to funded. */
const LIMIT_CONSUMING: PrismaStatus[] = [
  'PAYMENT_AUTHORIZED',
  'COMPLIANCE_REVIEW',
  'READY_FOR_PICKUP',
  'PARTIALLY_PICKED_UP',
  'PICKED_UP',
];

export async function buildRiskContext(input: {
  userId: string;
  totalChargedMinor: bigint;
  fundingCurrency: string;
  policy: RiskPolicyConfig;
  countryCode: string;
  ipCountry?: string | null;
  cardCountry?: string | null;
  deviceId?: string | null;
  locationRiskTier?: number;
  client?: PrismaTransactionClient;
}): Promise<RiskContext> {
  const client = input.client ?? prisma;
  const now = new Date();
  const dayStart = new Date(now.getTime() - 24 * 3600 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const velocityStart = new Date(now.getTime() - input.policy.velocityWindowHours * 3600 * 1000);

  const [user, dailyAgg, monthlyAgg, velocityCount, device, chargebackCount, failedPayments] =
    await Promise.all([
      client.user.findUnique({
        where: { id: input.userId },
        select: {
          createdAt: true,
          emailVerifiedAt: true,
          identityVerifications: {
            where: { status: 'APPROVED' },
            select: { id: true, sanctionsHit: true, pepHit: true },
            take: 1,
          },
        },
      }),
      client.transaction.aggregate({
        where: { userId: input.userId, createdAt: { gte: dayStart }, status: { in: LIMIT_CONSUMING } },
        _sum: { totalChargedMinor: true },
      }),
      client.transaction.aggregate({
        where: { userId: input.userId, createdAt: { gte: monthStart }, status: { in: LIMIT_CONSUMING } },
        _sum: { totalChargedMinor: true },
      }),
      client.transaction.count({
        where: { userId: input.userId, createdAt: { gte: velocityStart } },
      }),
      input.deviceId
        ? client.device.findUnique({
            where: { id: input.deviceId },
            select: { fingerprint: true, blocked: true, createdAt: true },
          })
        : Promise.resolve(null),
      client.chargeback.count({ where: { transaction: { userId: input.userId } } }),
      client.payment.count({
        where: {
          transaction: { userId: input.userId },
          status: 'FAILED',
          createdAt: { gte: dayStart },
        },
      }),
    ]);

  if (!user) throw new DomainError('NOT_FOUND', 'User not found');

  // How many distinct accounts share this device fingerprint — the mule signal.
  const deviceAccountCount = device
    ? await client.device
        .findMany({ where: { fingerprint: device.fingerprint }, select: { userId: true } })
        .then((rows) => new Set(rows.map((r) => r.userId)).size)
    : 1;

  const verification = user.identityVerifications[0];

  return {
    amount: fromMinor(input.totalChargedMinor, input.fundingCurrency),
    dailyTotalMinor: dailyAgg._sum.totalChargedMinor ?? 0n,
    monthlyTotalMinor: monthlyAgg._sum.totalChargedMinor ?? 0n,
    velocityCount,
    accountAgeHours: (now.getTime() - user.createdAt.getTime()) / 3_600_000,
    kycApproved: verification !== undefined,
    emailVerified: user.emailVerifiedAt !== null,
    ipCountry: input.ipCountry ?? null,
    cardCountry: input.cardCountry ?? null,
    payoutCountry: input.countryCode,
    deviceAccountCount,
    deviceIsNew: device ? now.getTime() - device.createdAt.getTime() < 3_600_000 : true,
    deviceBlocked: device?.blocked ?? false,
    priorChargebackCount: chargebackCount,
    priorFailedPaymentCount: failedPayments,
    locationRiskTier: input.locationRiskTier ?? 0,
    sanctionsHit: verification?.sanctionsHit ?? false,
    pepHit: verification?.pepHit ?? false,
  };
}

async function persistRiskEvents(
  assessment: RiskAssessment,
  input: { transactionId: string; userId: string; policyVersion: number },
  client: PrismaTransactionClient,
): Promise<void> {
  if (assessment.signals.length === 0) return;

  await client.riskEvent.createMany({
    data: assessment.signals.map((signal) => ({
      transactionId: input.transactionId,
      userId: input.userId,
      ruleKey: signal.ruleKey,
      ruleVersion: input.policyVersion,
      triggered: signal.triggered,
      score: signal.weight,
      level: signal.level,
      detail: signal.detail,
      signals: { weight: signal.weight } as Prisma.InputJsonValue,
    })),
  });
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export interface TransitionInput {
  readonly transactionId: string;
  readonly to: TransactionStatus;
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
  /** Extra columns to set atomically with the status change. */
  readonly patch?: Prisma.TransactionUpdateInput;
}

/**
 * The ONLY sanctioned way to change a transaction's status.
 *
 * The conditional `updateMany` on the expected prior status is what makes this
 * safe under concurrency: if another request moved the transaction first, zero
 * rows update and this call fails rather than silently overwriting.
 */
export async function transitionTransaction(
  input: TransitionInput,
  client: PrismaTransactionClient,
): Promise<{ from: TransactionStatus; to: TransactionStatus }> {
  const current = await client.transaction.findUnique({
    where: { id: input.transactionId },
    select: { id: true, status: true, reference: true },
  });

  if (!current) {
    throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');
  }

  const from = current.status as TransactionStatus;

  // Throws IllegalTransitionError if the edge does not exist or the actor is not
  // permitted to traverse it.
  assertTransition(from, input.to, input.actorType);

  const updated = await client.transaction.updateMany({
    where: { id: input.transactionId, status: from as PrismaStatus },
    data: {
      status: input.to as PrismaStatus,
      ...(input.patch as Prisma.TransactionUpdateManyMutationInput),
    },
  });

  if (updated.count === 0) {
    throw new DomainError(
      'CONFLICT',
      'The transaction changed while this request was in flight. Retry.',
    );
  }

  await client.transactionEvent.create({
    data: {
      transactionId: input.transactionId,
      fromStatus: from as PrismaStatus,
      toStatus: input.to as PrismaStatus,
      reason: input.reason ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  return { from, to: input.to };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateTransactionInput {
  readonly userId: string;
  readonly payoutAmountMinor: bigint;
  readonly countryCode: string;
  readonly fundingCurrency: string;
  readonly pickupLocationId?: string | null;
  readonly expedited?: boolean;
  readonly deviceId?: string | null;
  readonly ipAddress?: string | null;
  readonly ipCountry?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

export interface CreateTransactionResult {
  readonly transactionId: string;
  readonly reference: string;
  readonly status: TransactionStatus;
  readonly risk: RiskAssessment;
  readonly quoteId: string;
}

/**
 * Create a transaction.
 *
 * Pricing, risk, and limits are all evaluated server-side from stored
 * configuration. The client contributes the amount it wants to receive, a country,
 * and a preferred location — nothing else is trusted.
 */
export async function createTransaction(
  input: CreateTransactionInput,
): Promise<CreateTransactionResult> {
  const country = getEnabledCountry(input.countryCode);
  const policy = await getActiveRiskPolicy(country.code);

  // Price first: risk is assessed on the total the customer will actually be
  // charged, not on the payout they requested.
  const quote = await createQuote({
    payoutAmountMinor: input.payoutAmountMinor,
    payoutCurrency: country.payoutCurrency,
    fundingCurrency: input.fundingCurrency,
    countryCode: country.code,
    expedited: input.expedited ?? false,
  });

  let locationRiskTier = 0;
  if (input.pickupLocationId) {
    const location = await prisma.pickupLocation.findUnique({
      where: { id: input.pickupLocationId },
      select: {
        riskTier: true,
        status: true,
        countryCode: true,
        maxPayoutMinor: true,
        deletedAt: true,
      },
    });
    if (!location || location.status !== 'ACTIVE' || location.deletedAt) {
      throw new DomainError('PICKUP_LOCATION_UNAVAILABLE', 'That pickup location is unavailable');
    }
    if (location.countryCode !== country.code) {
      throw new DomainError('PICKUP_LOCATION_UNAVAILABLE', 'That pickup location is in another market');
    }
    if (input.payoutAmountMinor > location.maxPayoutMinor) {
      throw new DomainError(
        'PICKUP_LOCATION_CAPACITY',
        'That amount exceeds the maximum payout for this location',
      );
    }
    locationRiskTier = location.riskTier;
  }

  const context = await buildRiskContext({
    userId: input.userId,
    totalChargedMinor: quote.breakdown.totalCharged.amount,
    fundingCurrency: input.fundingCurrency,
    policy,
    countryCode: country.code,
    ipCountry: input.ipCountry,
    deviceId: input.deviceId,
    locationRiskTier,
  });

  const risk = evaluateRisk(context, policy);

  if (risk.decision === 'BLOCK') {
    await writeAudit({
      actorId: input.userId,
      actorType: 'customer',
      action: 'transaction.create.blocked',
      resourceType: 'transaction',
      success: false,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      requestId: input.requestId,
      metadata: { blockCode: risk.blockCode, score: risk.score, level: risk.level },
    });

    throw new DomainError(
      risk.blockCode ?? 'RISK_BLOCKED',
      'This transaction cannot be completed at this time',
      { riskLevel: risk.level },
    );
  }

  const reference = generateReference('LRM');

  const created = await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        reference,
        userId: input.userId,
        status: 'CREATED',
        countryCode: country.code,
        quoteId: quote.quoteId,
        payoutCurrency: quote.breakdown.payoutAmount.currency,
        payoutAmountMinor: quote.breakdown.payoutAmount.amount,
        fundingCurrency: quote.breakdown.principal.currency,
        totalChargedMinor: quote.breakdown.totalCharged.amount,
        platformFeeMinor: quote.breakdown.platformFee.amount,
        processingFeeMinor: quote.breakdown.processingFee.amount,
        effectiveRate: quote.breakdown.effectiveRate,
        riskScore: risk.score,
        riskLevel: risk.level,
        pickupLocationId: input.pickupLocationId ?? null,
        deviceId: input.deviceId ?? null,
        createdIp: input.ipAddress ?? null,
        createdCountry: input.ipCountry ?? null,
        expiresAt: quote.expiresAt,
      },
      select: { id: true, reference: true },
    });

    await tx.transactionEvent.create({
      data: {
        transactionId: transaction.id,
        fromStatus: null,
        toStatus: 'CREATED',
        reason: 'Transaction created',
        actorType: 'customer',
        actorId: input.userId,
        metadata: { riskScore: risk.score, riskLevel: risk.level },
      },
    });

    await persistRiskEvents(risk, {
      transactionId: transaction.id,
      userId: input.userId,
      policyVersion: policy.version,
    }, tx);

    // Route immediately: verification first if required, otherwise straight to
    // payment. The customer never chooses this.
    const nextStatus: TransactionStatus = risk.kycRequired ? 'KYC_REQUIRED' : 'PAYMENT_PENDING';

    await transitionTransaction(
      {
        transactionId: transaction.id,
        to: nextStatus,
        actorType: 'system',
        reason: risk.kycRequired
          ? 'Identity verification required for this amount'
          : 'Ready to collect payment',
        metadata: { riskScore: risk.score },
      },
      tx,
    );

    if (risk.kycRequired) {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { email: true, locale: true },
      });
      if (user) {
        await enqueueNotification(
          {
            userId: input.userId,
            transactionId: transaction.id,
            channel: 'EMAIL',
            event: 'kyc.required',
            recipient: user.email,
            locale: user.locale === 'ES' ? 'es' : 'en',
            variables: { reference: transaction.reference },
          },
          tx,
        );
      }
    }

    await writeAudit(
      {
        actorId: input.userId,
        actorType: 'customer',
        action: 'transaction.create',
        resourceType: 'transaction',
        resourceId: transaction.id,
        after: {
          reference: transaction.reference,
          payoutAmountMinor: quote.breakdown.payoutAmount.amount.toString(),
          totalChargedMinor: quote.breakdown.totalCharged.amount.toString(),
          riskScore: risk.score,
          riskLevel: risk.level,
          status: nextStatus,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        requestId: input.requestId,
      },
      tx,
    );

    return { id: transaction.id, reference: transaction.reference, status: nextStatus };
  });

  return {
    transactionId: created.id,
    reference: created.reference,
    status: created.status,
    risk,
    quoteId: quote.quoteId,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getTransactionForUser(transactionId: string, userId: string) {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, userId, deletedAt: null },
    include: {
      quote: true,
      pickupLocation: { include: { institution: true } },
      payments: { orderBy: { createdAt: 'desc' } },
      events: { orderBy: { createdAt: 'asc' } },
      pickupCode: {
        select: { status: true, expiresAt: true, attemptCount: true, maxAttempts: true, prefix: true },
      },
    },
  });

  if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');
  return transaction;
}

export async function listTransactionsForUser(
  userId: string,
  options: { limit?: number; cursor?: string; status?: TransactionStatus[] } = {},
) {
  return prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(options.status ? { status: { in: options.status as PrismaStatus[] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 20,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: {
      pickupLocation: { select: { branchName: true, city: true, institution: { select: { name: true } } } },
      pickupCode: { select: { status: true, expiresAt: true } },
    },
  });
}

/** Transactions with a live pickup code, for the dashboard's "ready" panel. */
export async function listCollectableTransactions(userId: string) {
  return prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      status: { in: ['READY_FOR_PICKUP', 'PARTIALLY_PICKED_UP'] },
    },
    orderBy: { readyAt: 'desc' },
    include: {
      pickupLocation: { select: { branchName: true, city: true, institution: { select: { name: true } } } },
      pickupCode: { select: { expiresAt: true, status: true } },
    },
  });
}

export function canCustomerCancel(status: TransactionStatus): boolean {
  return (
    status === 'CREATED' ||
    status === 'CUSTOMER_DETAILS_REQUIRED' ||
    status === 'KYC_REQUIRED' ||
    status === 'PAYMENT_PENDING' ||
    status === 'PAYMENT_FAILED'
  );
}

export async function cancelTransaction(input: {
  transactionId: string;
  userId: string;
  reason: string;
  ipAddress?: string | null;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findFirst({
      where: { id: input.transactionId, userId: input.userId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');

    if (!canCustomerCancel(transaction.status as TransactionStatus)) {
      throw new DomainError(
        'FORBIDDEN',
        'This transaction can no longer be cancelled. Contact support.',
      );
    }

    await transitionTransaction(
      {
        transactionId: input.transactionId,
        to: 'CANCELLED',
        actorType: 'customer',
        actorId: input.userId,
        reason: input.reason,
        patch: { cancelledAt: new Date(), cancelReason: input.reason },
      },
      tx,
    );

    await writeAudit(
      {
        actorId: input.userId,
        actorType: 'customer',
        action: 'transaction.cancel',
        resourceType: 'transaction',
        resourceId: input.transactionId,
        ipAddress: input.ipAddress,
        metadata: { reason: input.reason },
      },
      tx,
    );
  });
}

/** Screening hook used by the KYC flow. Kept here so risk stays in one service. */
export async function screenUser(input: {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  country?: string;
}) {
  return getSanctionsProvider().screen(input);
}

export { isRedeemable, quoteToMoney, consumeQuote, env as transactionEnv };
