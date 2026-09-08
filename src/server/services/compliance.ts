/**
 * Compliance service — holds, releases, KYC decisions, and case management.
 *
 * A compliance analyst can stop money and start it again. Nothing else in the
 * system has that authority, and every use of it is audited with the analyst's
 * identity attached.
 */

import { prisma } from '../db';
import { DomainError } from '@/lib/domain/errors';
import { getKycProvider, getSanctionsProvider } from '../providers/kyc';
import { transitionTransaction } from './transaction';
import { issuePickupCode } from './pickup';
import { writeAudit } from './audit';
import { enqueueNotification } from './notification';
import { generateReference } from '../auth/crypto';

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

export interface SubmitKycInput {
  readonly userId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string;
  readonly documentType: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE' | 'RESIDENCE_PERMIT';
  readonly documentNumber: string;
  readonly documentCountry: string;
  readonly residenceCountry: string;
  readonly transactionId?: string | null;
  readonly ipAddress?: string | null;
}

/**
 * Submit identity documents.
 *
 * The full document number is passed to the provider and then discarded — only
 * the last four digits are ever persisted. Screening runs alongside verification,
 * and a sanctions match is recorded as a compliance case rather than a silent
 * rejection.
 */
export async function submitKyc(input: SubmitKycInput): Promise<{
  status: 'APPROVED' | 'REJECTED' | 'PENDING' | 'MANUAL_REVIEW';
  verificationId: string;
}> {
  const kyc = getKycProvider();
  const sanctions = getSanctionsProvider();

  const [result, screening] = await Promise.all([
    kyc.submit({
      userId: input.userId,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      documentType: input.documentType,
      documentNumber: input.documentNumber,
      documentCountry: input.documentCountry,
      residenceCountry: input.residenceCountry,
    }),
    sanctions.screen({
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      country: input.residenceCountry,
    }),
  ]);

  // A sanctions hit overrides an otherwise successful verification.
  const decision = screening.sanctionsHit ? 'REJECTED' : result.decision;

  return prisma.$transaction(async (tx) => {
    const verification = await tx.identityVerification.create({
      data: {
        userId: input.userId,
        provider: kyc.name,
        providerRef: result.providerRef,
        status:
          decision === 'APPROVED'
            ? 'APPROVED'
            : decision === 'REJECTED'
              ? 'REJECTED'
              : 'PENDING',
        level: decision === 'APPROVED' ? 'BASIC' : 'NONE',
        documentType: input.documentType,
        documentLast4: result.documentLast4,
        documentCountry: input.documentCountry,
        sanctionsChecked: true,
        sanctionsHit: screening.sanctionsHit,
        pepHit: screening.pepHit,
        rejectionReason: screening.sanctionsHit
          ? 'Screening match requires manual review'
          : (result.rejectionReason ?? null),
        submittedAt: new Date(),
        decidedAt: decision === 'PENDING' || decision === 'MANUAL_REVIEW' ? null : new Date(),
        rawResult: { checks: result.checks, matchedLists: screening.matchedLists },
      },
      select: { id: true },
    });

    await tx.userProfile.upsert({
      where: { userId: input.userId },
      update: {
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: new Date(input.dateOfBirth),
        residenceCountry: input.residenceCountry,
      },
      create: {
        userId: input.userId,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: new Date(input.dateOfBirth),
        residenceCountry: input.residenceCountry,
      },
    });

    if (screening.sanctionsHit || screening.pepHit || decision === 'MANUAL_REVIEW') {
      await tx.complianceCase.create({
        data: {
          caseNumber: generateReference('CMP'),
          type: screening.sanctionsHit ? 'SANCTIONS_HIT' : screening.pepHit ? 'PEP_MATCH' : 'KYC_REVIEW',
          status: 'OPEN',
          priority: screening.sanctionsHit ? 'CRITICAL' : 'HIGH',
          subjectUserId: input.userId,
          transactionId: input.transactionId ?? null,
          summary: screening.sanctionsHit
            ? `Screening match against ${screening.matchedLists.join(', ')}`
            : screening.pepHit
              ? 'Politically exposed person match'
              : 'Identity verification requires manual review',
          sarFlagged: screening.sanctionsHit,
        },
      });
    }

    // Advance the waiting transaction, if there is one.
    if (input.transactionId) {
      const transaction = await tx.transaction.findUnique({
        where: { id: input.transactionId },
        select: { id: true, status: true },
      });

      if (transaction?.status === 'KYC_REQUIRED') {
        await transitionTransaction(
          { transactionId: transaction.id, to: 'KYC_PENDING', actorType: 'customer', actorId: input.userId, reason: 'Documents submitted' },
          tx,
        );

        if (decision === 'APPROVED') {
          await transitionTransaction(
            { transactionId: transaction.id, to: 'KYC_APPROVED', actorType: 'system', reason: 'Verification passed' },
            tx,
          );
          await transitionTransaction(
            { transactionId: transaction.id, to: 'PAYMENT_PENDING', actorType: 'system', reason: 'Cleared to fund' },
            tx,
          );
        } else if (decision === 'REJECTED') {
          await transitionTransaction(
            { transactionId: transaction.id, to: 'KYC_REJECTED', actorType: 'system', reason: 'Verification failed' },
            tx,
          );
        } else if (decision === 'MANUAL_REVIEW') {
          await transitionTransaction(
            { transactionId: transaction.id, to: 'COMPLIANCE_REVIEW', actorType: 'system', reason: 'Verification inconclusive' },
            tx,
          );
        }
      }
    }

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { email: true, locale: true },
    });
    if (user && (decision === 'APPROVED' || decision === 'REJECTED')) {
      await enqueueNotification(
        {
          userId: input.userId,
          transactionId: input.transactionId ?? null,
          channel: 'EMAIL',
          event: decision === 'APPROVED' ? 'kyc.approved' : 'kyc.rejected',
          recipient: user.email,
          locale: user.locale === 'ES' ? 'es' : 'en',
        },
        tx,
      );
    }

    await writeAudit(
      {
        actorId: input.userId,
        actorType: 'customer',
        action: 'kyc.submit',
        resourceType: 'identity_verification',
        resourceId: verification.id,
        // The document number is deliberately absent. Only the last 4 exist here.
        after: {
          decision,
          documentType: input.documentType,
          documentLast4: result.documentLast4,
          sanctionsHit: screening.sanctionsHit,
          pepHit: screening.pepHit,
        },
        ipAddress: input.ipAddress,
      },
      tx,
    );

    return {
      status: decision as 'APPROVED' | 'REJECTED' | 'PENDING' | 'MANUAL_REVIEW',
      verificationId: verification.id,
    };
  });
}

// ---------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------

export async function placeHold(input: {
  transactionId: string;
  analystId: string;
  reason: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
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
        type: 'MANUAL_REVIEW',
        status: 'IN_REVIEW',
        priority: input.priority ?? 'HIGH',
        subjectUserId: transaction.userId,
        transactionId: transaction.id,
        assigneeId: input.analystId,
        summary: input.reason,
      },
    });

    if (transaction.status === 'READY_FOR_PICKUP' || transaction.status === 'PARTIALLY_PICKED_UP') {
      await transitionTransaction(
        {
          transactionId: transaction.id,
          to: 'COMPLIANCE_REVIEW',
          actorType: 'compliance',
          actorId: input.analystId,
          reason: input.reason,
        },
        tx,
      );
    }

    await writeAudit(
      {
        actorId: input.analystId,
        actorType: 'compliance',
        action: 'compliance.hold.place',
        resourceType: 'transaction',
        resourceId: transaction.id,
        metadata: { reason: input.reason, caseNumber },
        ipAddress: input.ipAddress,
      },
      tx,
    );

    return { caseNumber };
  });
}

/**
 * Release a hold.
 *
 * If no pickup code has been issued yet — the common case, because the hold
 * happened right after capture — one is issued now. That is the moment the
 * customer's cash actually becomes collectable.
 */
export async function releaseHold(input: {
  transactionId: string;
  analystId: string;
  resolution: string;
  ipAddress?: string | null;
}): Promise<{ released: true; credentialIssued: boolean }> {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      include: { pickupCode: { select: { id: true } } },
    });
    if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');
    if (transaction.status !== 'COMPLIANCE_REVIEW') {
      throw new DomainError('CONFLICT', 'This transaction is not under compliance review');
    }

    await tx.complianceCase.updateMany({
      where: { transactionId: transaction.id, status: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } },
      data: {
        status: 'APPROVED',
        resolution: input.resolution,
        decidedAt: new Date(),
        decidedBy: input.analystId,
      },
    });

    let credentialIssued = false;
    if (!transaction.pickupCode) {
      await issuePickupCode(transaction.id, transaction.countryCode, tx);
      credentialIssued = true;
    }

    await transitionTransaction(
      {
        transactionId: transaction.id,
        to: 'READY_FOR_PICKUP',
        actorType: 'compliance',
        actorId: input.analystId,
        reason: input.resolution,
        patch: { readyAt: new Date() },
      },
      tx,
    );

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
          event: 'pickup.ready',
          recipient: user.email,
          locale: user.locale === 'ES' ? 'es' : 'en',
          variables: { reference: transaction.reference },
        },
        tx,
      );
    }

    await writeAudit(
      {
        actorId: input.analystId,
        actorType: 'compliance',
        action: 'compliance.hold.release',
        resourceType: 'transaction',
        resourceId: transaction.id,
        metadata: { resolution: input.resolution, credentialIssued },
        ipAddress: input.ipAddress,
      },
      tx,
    );

    return { released: true as const, credentialIssued };
  });
}

export async function rejectOnReview(input: {
  transactionId: string;
  analystId: string;
  reason: string;
  ipAddress?: string | null;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      select: { id: true, status: true },
    });
    if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');
    if (transaction.status !== 'COMPLIANCE_REVIEW') {
      throw new DomainError('CONFLICT', 'This transaction is not under compliance review');
    }

    await tx.complianceCase.updateMany({
      where: { transactionId: transaction.id, status: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } },
      data: {
        status: 'REJECTED',
        resolution: input.reason,
        decidedAt: new Date(),
        decidedBy: input.analystId,
      },
    });

    await transitionTransaction(
      {
        transactionId: transaction.id,
        to: 'REFUNDED',
        actorType: 'compliance',
        actorId: input.analystId,
        reason: input.reason,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: input.analystId,
        actorType: 'compliance',
        action: 'compliance.reject',
        resourceType: 'transaction',
        resourceId: transaction.id,
        metadata: { reason: input.reason },
        ipAddress: input.ipAddress,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export async function listComplianceCases(options: {
  status?: ('OPEN' | 'IN_REVIEW' | 'ESCALATED' | 'APPROVED' | 'REJECTED' | 'CLOSED')[];
  limit?: number;
} = {}) {
  return prisma.complianceCase.findMany({
    where: options.status ? { status: { in: options.status } } : { status: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } },
    include: {
      transaction: {
        select: {
          id: true,
          reference: true,
          status: true,
          payoutAmountMinor: true,
          payoutCurrency: true,
          riskScore: true,
          riskLevel: true,
        },
      },
      subjectUser: { select: { id: true, email: true } },
    },
    orderBy: [{ priority: 'desc' }, { openedAt: 'asc' }],
    take: options.limit ?? 50,
  });
}

export async function listPendingKyc(limit = 50) {
  return prisma.identityVerification.findMany({
    where: { status: 'PENDING' },
    include: { user: { select: { id: true, email: true } } },
    orderBy: { submittedAt: 'asc' },
    take: limit,
  });
}

export async function listFraudAlerts(limit = 50) {
  return prisma.fraudAlert.findMany({
    where: { status: { in: ['OPEN', 'INVESTIGATING'] } },
    include: { transaction: { select: { reference: true, status: true } } },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
}
