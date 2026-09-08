/**
 * Pickup service — issuing, verifying, and redeeming cash credentials.
 *
 * This is where money physically leaves the system, so it is the most defensive
 * code in the application:
 *
 *  * Redemption runs at SERIALIZABLE isolation with a conditional update, so two
 *    agents scanning the same code simultaneously produce exactly one payout.
 *  * Every verification attempt is counted and recorded, successful or not, with
 *    the agent, location, and address attached.
 *  * Failed attempts lock the code and open a fraud alert.
 *  * The agent-facing DTO is built by hand and contains no customer PII.
 */

import { prisma, withSerializableTransaction, type PrismaTransactionClient } from '../db';
import { env } from '../env';
import { DomainError } from '@/lib/domain/errors';
import { getCountry } from '@/lib/domain/countries';
import { fromMinor } from '@/lib/domain/money';
import {
  buildBankSettlementPosting,
} from '@/lib/domain/ledger';
import {
  checkCodeUsable,
  collectableFromFor,
  expiryFrom,
  generatePickupCredential,
  hashCode,
  hashSecret,
  maskCode,
  normalizeCode,
  safeCompareHash,
  shouldBurnAttempt,
  shouldLockAfterFailure,
} from '@/lib/domain/pickup-code';
import { detectCodeBruteForce } from '@/lib/domain/risk';
import { transitionTransaction } from './transaction';
import { postLedgerTransaction } from './ledger';
import { writeAudit } from './audit';
import { enqueueNotification } from './notification';
import { generateReference } from '../auth/crypto';

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

export interface IssuedCredential {
  /** Shown to the owning customer exactly once, then never retrievable again. */
  readonly code: string;
  readonly secret: string;
  readonly expiresAt: Date;
  /** Set when a risk-based hold applies; null means immediately collectable. */
  readonly collectableFrom: Date | null;
}

/**
 * Issue a pickup credential.
 *
 * Called only from the payment flow after funds are secured and compliance has
 * cleared. Returns the plaintext to the caller; only hashes are persisted.
 */
export async function issuePickupCode(
  transactionId: string,
  countryCode: string,
  client: PrismaTransactionClient,
): Promise<IssuedCredential> {
  const country = getCountry(countryCode);
  const credential = generatePickupCredential(country.pickupCodePrefix, env.PICKUP_CODE_PEPPER);
  const issuedAt = new Date();
  const expiresAt = expiryFrom(issuedAt, country.pickupCodeTtlDays);

  // Risk-based collection delay. Read here rather than passed in so every caller
  // — automatic release at capture, and manual release from compliance — gets
  // the control without having to remember to apply it.
  const [transaction, policy] = await Promise.all([
    client.transaction.findUnique({
      where: { id: transactionId },
      select: { riskScore: true },
    }),
    client.riskPolicy.findFirst({
      where: { countryCode: country.code, active: true },
      orderBy: { version: 'desc' },
      select: { collectionDelayMinutes: true, collectionDelayRiskThreshold: true },
    }),
  ]);

  const collectableFrom = collectableFromFor({
    issuedAt,
    riskScore: transaction?.riskScore ?? 0,
    delayMinutes: policy?.collectionDelayMinutes ?? 0,
    riskThreshold: policy?.collectionDelayRiskThreshold ?? 0,
  });

  await client.pickupCode.create({
    data: {
      transactionId,
      codeHash: credential.codeHash,
      secretHash: credential.secretHash,
      prefix: credential.prefix,
      status: 'ACTIVE',
      maxAttempts: country.pickupCodeMaxAttempts,
      collectableFrom,
      expiresAt,
    },
  });

  return { code: credential.code, secret: credential.secret, expiresAt, collectableFrom };
}

// ---------------------------------------------------------------------------
// Verification (read-only for the agent, but it burns an attempt)
// ---------------------------------------------------------------------------

/**
 * What a payout agent is allowed to see.
 *
 * Deliberately narrow. No name, email, phone, address, card details, funding
 * amount, or transaction history. The agent needs to know how much to hand over
 * and what document to check — nothing more. Identity matching happens against
 * the physical document, not against data on our screen.
 */
export interface AgentTransactionView {
  readonly reference: string;
  readonly status: string;
  readonly payoutAmountMinor: string;
  readonly payoutCurrency: string;
  readonly alreadyPaidMinor: string;
  readonly remainingMinor: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** ISO timestamp when a held transaction becomes collectable, or null. */
  readonly collectableFrom: string | null;
  readonly acceptedDocuments: readonly string[];
  readonly complianceCleared: boolean;
  readonly complianceNote: string | null;
  readonly locationName: string | null;
  readonly institutionName: string | null;
  readonly isDemoLocation: boolean;
}

export interface VerifyInput {
  readonly code: string;
  /** Present when the agent scanned a QR rather than typing. Second factor. */
  readonly secret?: string | null;
  readonly agentId: string;
  readonly institutionId: string | null;
  readonly locationId: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export type VerifyResult =
  | { readonly ok: true; readonly transactionId: string; readonly view: AgentTransactionView }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly attemptsRemaining?: number };

/**
 * Verify a presented code.
 *
 * Lookup is by hash, so an unknown code costs one indexed read. Every outcome is
 * recorded as a PickupEvent — successes for audit, failures for fraud detection.
 */
export async function verifyPickupCode(input: VerifyInput): Promise<VerifyResult> {
  let normalized: string;
  try {
    normalized = normalizeCode(input.code);
  } catch {
    await recordFailedAttempt(input, null, 'MALFORMED');
    return { ok: false, code: 'PICKUP_CODE_INVALID', message: 'That code is not valid.' };
  }

  const codeHash = hashCode(normalized, env.PICKUP_CODE_PEPPER);

  const record = await prisma.pickupCode.findUnique({
    where: { codeHash },
    include: {
      transaction: {
        include: {
          pickupLocation: { include: { institution: true } },
          complianceCases: { where: { status: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } }, take: 1 },
        },
      },
    },
  });

  if (!record) {
    // An unknown code is indistinguishable from a wrong one, by design.
    await recordFailedAttempt(input, codeHash, 'UNKNOWN_CODE');
    return { ok: false, code: 'PICKUP_CODE_INVALID', message: 'That code is not valid.' };
  }

  const usable = checkCodeUsable(
    {
      status: record.status,
      attemptCount: record.attemptCount,
      maxAttempts: record.maxAttempts,
      expiresAt: record.expiresAt,
      collectableFrom: record.collectableFrom,
    },
    new Date(),
  );

  if (!usable.ok) {
    // A code presented during its security hold is a customer arriving early,
    // not an attacker guessing. Record it, but do not consume an attempt — an
    // impatient customer must not be able to lock themselves out of their cash.
    await recordFailedAttempt(input, codeHash, usable.code, record.transactionId, {
      burnAttempt: shouldBurnAttempt(usable.code),
    });
    return { ok: false, code: usable.code, message: usable.reason };
  }

  // Second factor, when the agent scanned rather than typed. A mismatch means
  // someone rebuilt a QR payload around a code they saw — treat it as an attack.
  if (input.secret) {
    const expected = record.secretHash;
    if (!safeCompareHash(hashSecret(input.secret, env.PICKUP_CODE_PEPPER), expected)) {
      await burnAttempt(record.id, record.attemptCount, record.maxAttempts, record.transactionId, input);
      return { ok: false, code: 'PICKUP_CODE_INVALID', message: 'That code is not valid.' };
    }
  }

  const transaction = record.transaction;

  if (transaction.status !== 'READY_FOR_PICKUP' && transaction.status !== 'PARTIALLY_PICKED_UP') {
    await recordFailedAttempt(input, codeHash, 'NOT_READY', transaction.id);
    return {
      ok: false,
      code: 'PICKUP_NOT_READY',
      message: 'That transaction is not ready for pickup.',
    };
  }

  // Location scoping: an agent may only act where the transaction is routed.
  if (transaction.pickupLocationId && transaction.pickupLocationId !== input.locationId) {
    const sameInstitution =
      transaction.pickupLocation?.institutionId != null &&
      transaction.pickupLocation.institutionId === input.institutionId;

    if (!sameInstitution) {
      await recordFailedAttempt(input, codeHash, 'WRONG_LOCATION', transaction.id);
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'That transaction is not assigned to your location.',
      };
    }
  }

  const country = getCountry(transaction.countryCode);
  const remaining = transaction.payoutAmountMinor - transaction.paidOutMinor;
  const hold = transaction.complianceCases[0];

  await prisma.pickupEvent.create({
    data: {
      transactionId: transaction.id,
      eventType: 'VERIFICATION_SUCCESS',
      agentId: input.agentId,
      institutionId: input.institutionId,
      locationId: input.locationId,
      amountMinor: remaining,
      currency: transaction.payoutCurrency,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      metadata: { maskedCode: maskCode(normalized) },
    },
  });

  return {
    ok: true,
    transactionId: transaction.id,
    view: {
      reference: transaction.reference,
      status: transaction.status,
      payoutAmountMinor: transaction.payoutAmountMinor.toString(),
      payoutCurrency: transaction.payoutCurrency,
      alreadyPaidMinor: transaction.paidOutMinor.toString(),
      remainingMinor: remaining.toString(),
      createdAt: transaction.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      collectableFrom: record.collectableFrom?.toISOString() ?? null,
      acceptedDocuments: country.acceptedIdDocuments,
      complianceCleared: hold === undefined,
      complianceNote: hold ? 'On hold — do not disburse' : null,
      locationName: transaction.pickupLocation?.branchName ?? null,
      institutionName: transaction.pickupLocation?.institution.name ?? null,
      isDemoLocation: transaction.pickupLocation?.institution.isDemo ?? true,
    },
  };
}

async function burnAttempt(
  codeId: string,
  attemptCount: number,
  maxAttempts: number,
  transactionId: string,
  input: VerifyInput,
): Promise<void> {
  const willLock = shouldLockAfterFailure({
    status: 'ACTIVE',
    attemptCount,
    maxAttempts,
    expiresAt: new Date(Date.now() + 1000),
  });

  await prisma.pickupCode.update({
    where: { id: codeId },
    data: {
      attemptCount: { increment: 1 },
      ...(willLock ? { status: 'LOCKED', lockedAt: new Date() } : {}),
    },
  });

  await prisma.pickupEvent.create({
    data: {
      transactionId,
      eventType: willLock ? 'CODE_LOCKED' : 'VERIFICATION_FAILED',
      agentId: input.agentId,
      institutionId: input.institutionId,
      locationId: input.locationId,
      ipAddress: input.ipAddress ?? null,
      reason: 'SECRET_MISMATCH',
    },
  });

  if (willLock) {
    await raiseFraudAlert({
      type: 'CODE_BRUTE_FORCE',
      severity: 'HIGH',
      transactionId,
      description: 'Pickup code locked after repeated failed verification attempts',
      evidence: { agentId: input.agentId, locationId: input.locationId },
    });
  }
}

/**
 * Record a failed attempt and check for a brute-force pattern.
 *
 * Attempts are also counted per agent and per address, not just per code — an
 * attacker guessing codes spreads attempts across many codes precisely to stay
 * under any per-code cap.
 */
async function recordFailedAttempt(
  input: VerifyInput,
  attemptedCodeHash: string | null,
  reason: string,
  transactionId?: string,
  options: { burnAttempt?: boolean } = {},
): Promise<void> {
  // Named distinctly from the burnAttempt() helper above to avoid shadowing it.
  const shouldCountAttempt = options.burnAttempt ?? true;
  await prisma.pickupEvent.create({
    data: {
      transactionId: transactionId ?? null,
      eventType: 'VERIFICATION_FAILED',
      agentId: input.agentId,
      institutionId: input.institutionId,
      locationId: input.locationId,
      attemptedCodeHash,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      reason,
    },
  });

  if (shouldCountAttempt && transactionId && attemptedCodeHash) {
    const record = await prisma.pickupCode.findFirst({
      where: { codeHash: attemptedCodeHash },
      select: { id: true, attemptCount: true, maxAttempts: true, status: true },
    });
    if (record && record.status === 'ACTIVE') {
      const willLock = shouldLockAfterFailure({
        status: 'ACTIVE',
        attemptCount: record.attemptCount,
        maxAttempts: record.maxAttempts,
        expiresAt: new Date(Date.now() + 1000),
      });
      await prisma.pickupCode.update({
        where: { id: record.id },
        data: {
          attemptCount: { increment: 1 },
          ...(willLock ? { status: 'LOCKED', lockedAt: new Date() } : {}),
        },
      });
    }
  }

  const hourAgo = new Date(Date.now() - 3_600_000);
  const recent = await prisma.pickupEvent.findMany({
    where: {
      agentId: input.agentId,
      eventType: { in: ['VERIFICATION_FAILED', 'CODE_LOCKED'] },
      createdAt: { gte: hourAgo },
    },
    select: { attemptedCodeHash: true },
  });

  const detection = detectCodeBruteForce({
    failedAttemptsLastHour: recent.length,
    distinctCodesAttempted: new Set(recent.map((r) => r.attemptedCodeHash).filter(Boolean)).size,
  });

  if (detection.detected) {
    await raiseFraudAlert({
      type: 'CODE_BRUTE_FORCE',
      severity: detection.severity,
      transactionId: transactionId ?? null,
      description: detection.detail,
      evidence: {
        agentId: input.agentId,
        locationId: input.locationId,
        ipAddress: input.ipAddress ?? null,
      },
    });
  }
}

async function raiseFraudAlert(input: {
  type: 'CODE_BRUTE_FORCE' | 'AGENT_ANOMALY' | 'DUPLICATE_TRANSACTION';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  transactionId?: string | null;
  description: string;
  evidence: Record<string, unknown>;
}): Promise<void> {
  await prisma.fraudAlert.create({
    data: {
      alertNumber: generateReference('ALT'),
      type: input.type,
      severity: input.severity,
      status: 'OPEN',
      transactionId: input.transactionId ?? null,
      description: input.description,
      evidence: input.evidence as object,
    },
  });
}

// ---------------------------------------------------------------------------
// Redemption — cash actually changes hands
// ---------------------------------------------------------------------------

export interface RedeemInput {
  readonly code: string;
  readonly agentId: string;
  readonly institutionId: string | null;
  readonly locationId: string;
  readonly documentType: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE' | 'RESIDENCE_PERMIT';
  readonly documentLast4: string;
  readonly amountMinor: bigint;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface RedeemResult {
  readonly transactionId: string;
  readonly reference: string;
  readonly paidMinor: bigint;
  readonly remainingMinor: bigint;
  readonly fullyPaid: boolean;
}

/**
 * Redeem a code and record the disbursement.
 *
 * SERIALIZABLE plus a conditional update on `status: 'ACTIVE'` is what guarantees
 * single redemption. If two agents scan simultaneously, PostgreSQL aborts one and
 * exactly one payout is recorded — the database is the arbiter, not application
 * logic that could be raced.
 */
export async function redeemPickupCode(input: RedeemInput): Promise<RedeemResult> {
  const normalized = normalizeCode(input.code);
  const codeHash = hashCode(normalized, env.PICKUP_CODE_PEPPER);

  return withSerializableTransaction(async (tx) => {
    const record = await tx.pickupCode.findUnique({
      where: { codeHash },
      include: { transaction: { include: { pickupLocation: true } } },
    });

    if (!record) throw new DomainError('PICKUP_CODE_INVALID', 'That code is not valid');

    // Every guard is re-applied here, not just trusted from the earlier verify
    // call. Redemption is a separate endpoint an agent can reach directly, so a
    // control enforced only at verification is a control that can be skipped.
    const usable = checkCodeUsable(
      {
        status: record.status,
        attemptCount: record.attemptCount,
        maxAttempts: record.maxAttempts,
        expiresAt: record.expiresAt,
        collectableFrom: record.collectableFrom,
      },
      new Date(),
    );
    if (!usable.ok) throw new DomainError(usable.code, usable.reason);

    const transaction = record.transaction;

    if (transaction.status !== 'READY_FOR_PICKUP' && transaction.status !== 'PARTIALLY_PICKED_UP') {
      throw new DomainError('PICKUP_NOT_READY', 'That transaction is not ready for pickup');
    }

    // An open compliance case blocks disbursement outright.
    const hold = await tx.complianceCase.findFirst({
      where: { transactionId: transaction.id, status: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } },
      select: { id: true },
    });
    if (hold) {
      throw new DomainError('COMPLIANCE_HOLD', 'This transaction is on hold and must not be disbursed');
    }

    if (transaction.pickupLocationId && transaction.pickupLocationId !== input.locationId) {
      const sameInstitution =
        transaction.pickupLocation?.institutionId != null &&
        transaction.pickupLocation.institutionId === input.institutionId;
      if (!sameInstitution) {
        throw new DomainError('FORBIDDEN', 'That transaction is not assigned to your location');
      }
    }

    const remaining = transaction.payoutAmountMinor - transaction.paidOutMinor;
    if (input.amountMinor <= 0n || input.amountMinor > remaining) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The disbursement amount must be positive and no more than the outstanding balance',
      );
    }

    const fullyPaid = input.amountMinor === remaining;

    // The single-redemption guard. Only a full payout closes the code.
    if (fullyPaid) {
      const claimed = await tx.pickupCode.updateMany({
        where: { id: record.id, status: 'ACTIVE' },
        data: {
          status: 'REDEEMED',
          redeemedAt: new Date(),
          redeemedBy: input.agentId,
          redeemedAtLocationId: input.locationId,
        },
      });
      if (claimed.count === 0) {
        throw new DomainError('PICKUP_CODE_ALREADY_REDEEMED', 'That code has already been redeemed');
      }
    }

    const newPaidOut = transaction.paidOutMinor + input.amountMinor;

    await transitionTransaction(
      {
        transactionId: transaction.id,
        to: fullyPaid ? 'PICKED_UP' : 'PARTIALLY_PICKED_UP',
        actorType: 'agent',
        actorId: input.agentId,
        reason: fullyPaid ? 'Cash disbursed in full' : 'Partial cash disbursement',
        metadata: {
          amountMinor: input.amountMinor.toString(),
          locationId: input.locationId,
          documentType: input.documentType,
        },
        patch: {
          paidOutMinor: newPaidOut,
          ...(fullyPaid ? { completedAt: new Date() } : {}),
        },
      },
      tx,
    );

    // The ledger entry that discharges the customer obligation and creates the
    // partner payable. Sequenced so partial disbursements each post uniquely.
    const sequence = fullyPaid && transaction.paidOutMinor === 0n ? undefined : Number(newPaidOut);
    await postLedgerTransaction(
      buildBankSettlementPosting({
        transactionRef: transaction.reference,
        payoutAmount: fromMinor(input.amountMinor, transaction.payoutCurrency),
        sequence,
      }),
      { transactionId: transaction.id },
      tx,
    );

    await tx.pickupEvent.create({
      data: {
        transactionId: transaction.id,
        eventType: 'PAYOUT_COMPLETED',
        agentId: input.agentId,
        institutionId: input.institutionId,
        locationId: input.locationId,
        amountMinor: input.amountMinor,
        currency: transaction.payoutCurrency,
        documentType: input.documentType,
        documentLast4: input.documentLast4,
        verificationResult: 'VERIFIED',
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
      },
    });

    await tx.pickupLocation.update({
      where: { id: input.locationId },
      data: { dailyUsedMinor: { increment: input.amountMinor } },
    });

    if (fullyPaid) {
      const user = await tx.user.findUnique({
        where: { id: transaction.userId },
        select: { email: true, locale: true },
      });
      if (user) {
        await enqueueNotification(
          {
            userId: transaction.userId,
            transactionId: transaction.id,
            channel: 'EMAIL',
            event: 'pickup.completed',
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
        actorId: input.agentId,
        actorType: 'agent',
        action: 'pickup.redeem',
        resourceType: 'transaction',
        resourceId: transaction.id,
        after: {
          amountMinor: input.amountMinor.toString(),
          paidOutMinor: newPaidOut.toString(),
          locationId: input.locationId,
          institutionId: input.institutionId,
          documentType: input.documentType,
          documentLast4: input.documentLast4,
          fullyPaid,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      tx,
    );

    return {
      transactionId: transaction.id,
      reference: transaction.reference,
      paidMinor: input.amountMinor,
      remainingMinor: transaction.payoutAmountMinor - newPaidOut,
      fullyPaid,
    };
  });
}

// ---------------------------------------------------------------------------
// Agent actions that are not disbursement
// ---------------------------------------------------------------------------

export async function rejectPickup(input: {
  transactionId: string;
  agentId: string;
  institutionId: string | null;
  locationId: string;
  reason: string;
  ipAddress?: string | null;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.pickupEvent.create({
      data: {
        transactionId: input.transactionId,
        eventType: 'PAYOUT_REJECTED',
        agentId: input.agentId,
        institutionId: input.institutionId,
        locationId: input.locationId,
        reason: input.reason,
        ipAddress: input.ipAddress ?? null,
      },
    });

    await writeAudit(
      {
        actorId: input.agentId,
        actorType: 'agent',
        action: 'pickup.reject',
        resourceType: 'transaction',
        resourceId: input.transactionId,
        metadata: { reason: input.reason, locationId: input.locationId },
        ipAddress: input.ipAddress,
      },
      tx,
    );
  });
}

/**
 * Escalate to compliance. Opens a case, which immediately blocks disbursement
 * everywhere — including at other locations of the same institution.
 */
export async function escalatePickup(input: {
  transactionId: string;
  agentId: string;
  institutionId: string | null;
  locationId: string;
  reason: string;
  ipAddress?: string | null;
}): Promise<{ caseNumber: string }> {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      select: { id: true, status: true, userId: true },
    });
    if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');

    const caseNumber = generateReference('CMP');

    await tx.complianceCase.create({
      data: {
        caseNumber,
        type: 'FRAUD_REVIEW',
        status: 'OPEN',
        priority: 'HIGH',
        subjectUserId: transaction.userId,
        transactionId: transaction.id,
        summary: `Escalated from the payout window: ${input.reason}`,
      },
    });

    await tx.pickupEvent.create({
      data: {
        transactionId: input.transactionId,
        eventType: 'PAYOUT_ESCALATED',
        agentId: input.agentId,
        institutionId: input.institutionId,
        locationId: input.locationId,
        reason: input.reason,
        ipAddress: input.ipAddress ?? null,
      },
    });

    if (transaction.status === 'READY_FOR_PICKUP' || transaction.status === 'PARTIALLY_PICKED_UP') {
      await transitionTransaction(
        {
          transactionId: input.transactionId,
          to: 'COMPLIANCE_REVIEW',
          actorType: 'compliance',
          actorId: input.agentId,
          reason: `Escalated at the payout window: ${input.reason}`,
        },
        tx,
      );
    }

    await writeAudit(
      {
        actorId: input.agentId,
        actorType: 'agent',
        action: 'pickup.escalate',
        resourceType: 'transaction',
        resourceId: input.transactionId,
        metadata: { reason: input.reason, caseNumber },
        ipAddress: input.ipAddress,
      },
      tx,
    );

    return { caseNumber };
  });
}

// ---------------------------------------------------------------------------
// Location directory
// ---------------------------------------------------------------------------

export async function listPickupLocations(options: {
  countryCode?: string;
  city?: string;
  query?: string;
  activeOnly?: boolean;
  limit?: number;
}) {
  const { query } = options;

  return prisma.pickupLocation.findMany({
    where: {
      deletedAt: null,
      ...(options.countryCode ? { countryCode: options.countryCode } : {}),
      ...(options.city ? { city: { equals: options.city, mode: 'insensitive' } } : {}),
      ...(options.activeOnly === false ? {} : { status: 'ACTIVE' }),
      ...(query
        ? {
            OR: [
              { city: { contains: query, mode: 'insensitive' as const } },
              { province: { contains: query, mode: 'insensitive' as const } },
              { branchName: { contains: query, mode: 'insensitive' as const } },
              { institution: { name: { contains: query, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    },
    include: { institution: { select: { name: true, code: true, isDemo: true } } },
    orderBy: [{ province: 'asc' }, { city: 'asc' }, { branchName: 'asc' }],
    take: options.limit ?? 100,
  });
}

export async function getPickupCodeStatus(transactionId: string, userId: string) {
  const record = await prisma.pickupCode.findFirst({
    where: { transactionId, transaction: { userId } },
    select: {
      status: true,
      expiresAt: true,
      collectableFrom: true,
      attemptCount: true,
      maxAttempts: true,
      redeemedAt: true,
      prefix: true,
    },
  });
  if (!record) throw new DomainError('NOT_FOUND', 'No pickup code for this transaction');
  return record;
}
