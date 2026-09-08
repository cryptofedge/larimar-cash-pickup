/**
 * Payment service.
 *
 * Orchestrates the provider, the ledger, the state machine, and pickup-code
 * issuance as one atomic unit. The critical property: a captured payment and its
 * ledger entries and its state transition either all happen or none do.
 *
 * No card data passes through this module. The client exchanges card details with
 * the provider directly and hands us an opaque token.
 */

import { prisma, withSerializableTransaction } from '../db';
import { env } from '../env';
import { DomainError } from '@/lib/domain/errors';
import { fromMinor, money } from '@/lib/domain/money';
import {
  buildCustomerPaymentPosting,
  buildFxConversionPosting,
  buildPayoutLiabilityPosting,
  buildPlatformFeePosting,
  buildProcessingFeePosting,
  buildChargebackPosting,
} from '@/lib/domain/ledger';
import { getPaymentProvider } from '../providers/payment';
import { validateQuoteForAuthorization, consumeQuote } from './pricing';
import { transitionTransaction, getActiveRiskPolicy } from './transaction';
import { postLedgerTransaction, reverseAllPostingsForTransaction } from './ledger';
import { issuePickupCode, type IssuedCredential } from './pickup';
import { writeAudit } from './audit';
import { enqueueNotification } from './notification';
import { generateReference } from '../auth/crypto';

// ---------------------------------------------------------------------------
// Intent creation
// ---------------------------------------------------------------------------

export interface CreateIntentResult {
  readonly paymentId: string;
  readonly providerRef: string;
  /** Handed to the browser so it can talk to the provider. Not a stored secret. */
  readonly clientSecret: string;
  readonly amountMinor: string;
  readonly currency: string;
}

export async function createPaymentIntent(input: {
  transactionId: string;
  userId: string;
  idempotencyKey: string;
  ipAddress?: string | null;
}): Promise<CreateIntentResult> {
  const transaction = await prisma.transaction.findFirst({
    where: { id: input.transactionId, userId: input.userId, deletedAt: null },
    include: { quote: true },
  });

  if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');
  if (transaction.status !== 'PAYMENT_PENDING') {
    throw new DomainError(
      'CONFLICT',
      `This transaction is not awaiting payment (status: ${transaction.status})`,
    );
  }

  // Reuse an existing intent rather than creating a second one for the same
  // transaction — a customer refreshing checkout must not create two charges.
  const existing = await prisma.payment.findFirst({
    where: { transactionId: transaction.id, status: { in: ['CREATED', 'REQUIRES_ACTION'] } },
    orderBy: { createdAt: 'desc' },
  });

  const provider = getPaymentProvider();

  if (existing) {
    const status = await provider.getPaymentStatus(existing.providerRef);
    if (status.status === 'CREATED' || status.status === 'REQUIRES_ACTION') {
      return {
        paymentId: existing.id,
        providerRef: existing.providerRef,
        clientSecret: `${existing.providerRef}_secret_reuse`,
        amountMinor: existing.amountMinor.toString(),
        currency: existing.currency,
      };
    }
  }

  const intent = await provider.createPayment({
    amountMinor: transaction.totalChargedMinor,
    currency: transaction.fundingCurrency,
    reference: transaction.reference,
    customerRef: input.userId,
    description: `Larimar cash pickup ${transaction.reference}`,
    idempotencyKey: input.idempotencyKey,
  });

  const payment = await prisma.payment.create({
    data: {
      transactionId: transaction.id,
      provider: provider.name,
      providerRef: intent.providerRef,
      status: 'CREATED',
      amountMinor: transaction.totalChargedMinor,
      currency: transaction.fundingCurrency,
    },
    select: { id: true },
  });

  await writeAudit({
    actorId: input.userId,
    actorType: 'customer',
    action: 'payment.intent.create',
    resourceType: 'payment',
    resourceId: payment.id,
    metadata: { transactionId: transaction.id, provider: provider.name },
    ipAddress: input.ipAddress,
  });

  return {
    paymentId: payment.id,
    providerRef: intent.providerRef,
    clientSecret: intent.clientSecret,
    amountMinor: transaction.totalChargedMinor.toString(),
    currency: transaction.fundingCurrency,
  };
}

// ---------------------------------------------------------------------------
// Authorisation and capture
// ---------------------------------------------------------------------------

export interface ConfirmPaymentResult {
  readonly status: 'READY_FOR_PICKUP' | 'COMPLIANCE_REVIEW' | 'PAYMENT_FAILED' | 'REQUIRES_ACTION';
  readonly transactionId: string;
  readonly reference: string;
  /** Present only on the first successful confirmation, and never retrievable again. */
  readonly credential?: IssuedCredential;
  readonly actionUrl?: string;
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

/**
 * Authorise, capture, post the ledger, and issue the pickup code.
 *
 * The quote is re-validated first. A customer who left checkout open across a
 * market move does not get to authorise a stale price, and one who already used
 * this quote cannot use it twice.
 */
export async function confirmPayment(input: {
  transactionId: string;
  userId: string;
  paymentToken: string;
  idempotencyKey: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ConfirmPaymentResult> {
  const transaction = await prisma.transaction.findFirst({
    where: { id: input.transactionId, userId: input.userId, deletedAt: null },
    include: { quote: true },
  });

  if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');
  if (transaction.status !== 'PAYMENT_PENDING') {
    throw new DomainError(
      'CONFLICT',
      `This transaction is not awaiting payment (status: ${transaction.status})`,
    );
  }

  const quoteCheck = await validateQuoteForAuthorization(transaction.quoteId);
  if (!quoteCheck.ok) {
    throw new DomainError(
      quoteCheck.code,
      quoteCheck.code === 'RATE_DRIFTED'
        ? 'The exchange rate moved. Please review the updated price.'
        : 'That price has expired. Please start again with a fresh quote.',
    );
  }

  const payment = await prisma.payment.findFirst({
    where: { transactionId: transaction.id, status: { in: ['CREATED', 'REQUIRES_ACTION'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) throw new DomainError('NOT_FOUND', 'No payment intent for this transaction');

  const provider = getPaymentProvider();
  const attemptNumber =
    (await prisma.paymentAttempt.count({ where: { paymentId: payment.id } })) + 1;

  const authorization = await provider.authorizePayment({
    providerRef: payment.providerRef,
    paymentToken: input.paymentToken,
    idempotencyKey: input.idempotencyKey,
  });

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      attemptNumber,
      status: authorization.status === 'AUTHORIZED' ? 'AUTHORIZED' : authorization.status === 'REQUIRES_ACTION' ? 'REQUIRES_ACTION' : 'FAILED',
      operation: 'authorize',
      failureCode: authorization.failureCode ?? null,
      failureMessage: authorization.failureMessage ?? null,
      ipAddress: input.ipAddress ?? null,
    },
  });

  // --- Declined ---------------------------------------------------------
  if (authorization.status === 'FAILED') {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureCode: authorization.failureCode ?? null,
          failureMessage: authorization.failureMessage ?? null,
          ...cardColumns(authorization.card),
        },
      });

      await transitionTransaction(
        {
          transactionId: transaction.id,
          to: 'PAYMENT_FAILED',
          actorType: 'system',
          reason: authorization.failureMessage ?? 'Payment declined',
          metadata: { failureCode: authorization.failureCode },
        },
        tx,
      );

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
            event: 'payment.failed',
            recipient: user.email,
            locale: user.locale === 'ES' ? 'es' : 'en',
            variables: { reference: transaction.reference },
          },
          tx,
        );
      }

      await writeAudit(
        {
          actorId: input.userId,
          actorType: 'customer',
          action: 'payment.failed',
          resourceType: 'payment',
          resourceId: payment.id,
          success: false,
          metadata: { failureCode: authorization.failureCode, transactionId: transaction.id },
          ipAddress: input.ipAddress,
        },
        tx,
      );
    });

    return {
      status: 'PAYMENT_FAILED',
      transactionId: transaction.id,
      reference: transaction.reference,
      failureCode: authorization.failureCode ?? 'declined',
      failureMessage: authorization.failureMessage ?? 'The payment was declined',
    };
  }

  // --- 3-D Secure challenge --------------------------------------------
  if (authorization.status === 'REQUIRES_ACTION') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'REQUIRES_ACTION',
        threeDsResult: authorization.threeDsResult ?? null,
        ...cardColumns(authorization.card),
      },
    });
    return {
      status: 'REQUIRES_ACTION',
      transactionId: transaction.id,
      reference: transaction.reference,
      actionUrl: authorization.actionUrl,
    };
  }

  // --- Authorised: capture and settle ----------------------------------
  const capture = await provider.capturePayment({
    providerRef: payment.providerRef,
    amountMinor: transaction.totalChargedMinor,
    idempotencyKey: `${input.idempotencyKey}:capture`,
  });

  if (capture.status !== 'CAPTURED') {
    throw new DomainError(
      'PAYMENT_FAILED',
      capture.failureMessage ?? 'The payment could not be captured',
    );
  }

  const policy = await getActiveRiskPolicy(transaction.countryCode);
  const needsReview = transaction.riskScore >= policy.reviewScoreThreshold;

  const result = await withSerializableTransaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CAPTURED',
        capturedMinor: capture.capturedMinor,
        authorizedAt: new Date(),
        capturedAt: new Date(),
        threeDsResult: authorization.threeDsResult ?? null,
        paymentToken: input.paymentToken,
        ...cardColumns(authorization.card),
      },
    });

    await tx.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNumber: attemptNumber + 1,
        status: 'CAPTURED',
        operation: 'capture',
        ipAddress: input.ipAddress ?? null,
      },
    });

    await consumeQuote(transaction.quoteId, tx);

    await transitionTransaction(
      {
        transactionId: transaction.id,
        to: 'PAYMENT_AUTHORIZED',
        actorType: 'webhook',
        reason: 'Payment authorised and captured',
        metadata: { providerRef: payment.providerRef },
        patch: { fundedAt: new Date() },
      },
      tx,
    );

    // --- Ledger: the complete funding lifecycle in one atomic block -----
    const quote = transaction.quote;
    const currency = transaction.fundingCurrency;
    const principal = fromMinor(quote.principalMinor, currency);
    const platformFee = fromMinor(quote.platformFeeMinor, currency);
    const processingFee = fromMinor(quote.processingFeeMinor, currency);
    const totalCharged = fromMinor(quote.totalChargedMinor, currency);
    const payoutAmount = fromMinor(quote.payoutAmountMinor, quote.payoutCurrency);

    // The spread earned: what we charged for the principal versus what the same
    // payout would have cost at mid-market.
    const principalAtMid =
      (quote.payoutAmountMinor * 100_000_000n + quote.midRate - 1n) / quote.midRate;
    const spreadRevenue = money(
      quote.principalMinor > principalAtMid ? quote.principalMinor - principalAtMid : 0n,
      currency,
    );

    await postLedgerTransaction(
      buildCustomerPaymentPosting({ transactionRef: transaction.reference, totalCharged }),
      { transactionId: transaction.id },
      tx,
    );
    await postLedgerTransaction(
      buildPlatformFeePosting({ transactionRef: transaction.reference, platformFee }),
      { transactionId: transaction.id },
      tx,
    );
    await postLedgerTransaction(
      buildProcessingFeePosting({ transactionRef: transaction.reference, processingFee }),
      { transactionId: transaction.id },
      tx,
    );
    await postLedgerTransaction(
      buildFxConversionPosting({
        transactionRef: transaction.reference,
        principal,
        fxSpreadRevenue: spreadRevenue,
      }),
      { transactionId: transaction.id },
      tx,
    );
    await postLedgerTransaction(
      buildPayoutLiabilityPosting({ transactionRef: transaction.reference, payoutAmount }),
      { transactionId: transaction.id },
      tx,
    );

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { email: true, locale: true },
    });
    const locale = user?.locale === 'ES' ? ('es' as const) : ('en' as const);

    if (user) {
      await enqueueNotification(
        {
          userId: input.userId,
          transactionId: transaction.id,
          channel: 'EMAIL',
          event: 'payment.succeeded',
          recipient: user.email,
          locale,
          variables: { reference: transaction.reference },
        },
        tx,
      );
    }

    // --- Route: automatic release, or hold for a human -----------------
    if (needsReview) {
      await tx.complianceCase.create({
        data: {
          caseNumber: generateReference('CMP'),
          type: 'AML_MONITORING',
          status: 'OPEN',
          priority: transaction.riskLevel,
          subjectUserId: input.userId,
          transactionId: transaction.id,
          summary: `Automatic review: risk score ${transaction.riskScore} at or above the ${policy.reviewScoreThreshold} threshold`,
        },
      });

      await transitionTransaction(
        {
          transactionId: transaction.id,
          to: 'COMPLIANCE_REVIEW',
          actorType: 'system',
          reason: `Risk score ${transaction.riskScore} requires review`,
        },
        tx,
      );

      await writeAudit(
        {
          actorId: input.userId,
          actorType: 'customer',
          action: 'payment.captured',
          resourceType: 'payment',
          resourceId: payment.id,
          after: { status: 'COMPLIANCE_REVIEW', capturedMinor: capture.capturedMinor.toString() },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
        tx,
      );

      return { status: 'COMPLIANCE_REVIEW' as const, credential: undefined };
    }

    const credential = await issuePickupCode(transaction.id, transaction.countryCode, tx);

    await transitionTransaction(
      {
        transactionId: transaction.id,
        to: 'READY_FOR_PICKUP',
        actorType: 'system',
        reason: 'Cleared automatically; pickup code issued',
        patch: { readyAt: new Date(), expiresAt: credential.expiresAt },
      },
      tx,
    );

    if (user) {
      await enqueueNotification(
        {
          userId: input.userId,
          transactionId: transaction.id,
          channel: 'EMAIL',
          event: 'pickup.ready',
          recipient: user.email,
          locale,
          variables: { reference: transaction.reference },
        },
        tx,
      );
    }

    await writeAudit(
      {
        actorId: input.userId,
        actorType: 'customer',
        action: 'payment.captured',
        resourceType: 'payment',
        resourceId: payment.id,
        // Note: the credential itself is never audited. Only that one was issued.
        after: {
          status: 'READY_FOR_PICKUP',
          capturedMinor: capture.capturedMinor.toString(),
          pickupCodeIssued: true,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      tx,
    );

    return { status: 'READY_FOR_PICKUP' as const, credential };
  });

  return {
    status: result.status,
    transactionId: transaction.id,
    reference: transaction.reference,
    ...(result.credential ? { credential: result.credential } : {}),
  };
}

function cardColumns(card?: { brand: string; last4: string; bin: string; country: string; methodType: string }) {
  if (!card) return {};
  return {
    cardBrand: card.brand,
    cardLast4: card.last4,
    cardBin: card.bin,
    cardCountry: card.country,
    methodType: card.methodType as 'CARD_DEBIT' | 'CARD_CREDIT',
  };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export async function issueRefund(input: {
  transactionId: string;
  amountMinor: bigint;
  reason: string;
  requestedBy: string;
  ipAddress?: string | null;
}): Promise<{ refundId: string }> {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      include: { payments: { where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } }, take: 1 } },
    });
    if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');

    const payment = transaction.payments[0];
    if (!payment) throw new DomainError('PAYMENT_NOT_AUTHORIZED', 'No captured payment to refund');

    const refundable = payment.capturedMinor - payment.refundedMinor;
    if (input.amountMinor <= 0n || input.amountMinor > refundable) {
      throw new DomainError('REFUND_EXCEEDS_CAPTURED', 'Refund exceeds the captured amount');
    }

    /**
     * KNOWN LIMITATION — partial refunds are not supported.
     *
     * A full refund is modelled by reversing the entire posting chain, which is
     * unambiguous. A partial refund would need the returned amount apportioned
     * across the platform fee, the processing fee, the FX spread, and the
     * principal — and the correct apportionment is a commercial policy decision
     * (are fees refundable? pro rata or not?), not an engineering one.
     *
     * Guessing would produce a ledger that balances but misstates revenue.
     * Refusing is the honest behaviour until that policy exists.
     */
    if (input.amountMinor !== refundable) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Partial refunds are not supported. Refund the full outstanding amount, or handle this case manually with a documented ledger adjustment.',
      );
    }

    const provider = getPaymentProvider();
    const result = await provider.refundPayment({
      providerRef: payment.providerRef,
      amountMinor: input.amountMinor,
      reason: input.reason,
      idempotencyKey: `refund:${input.transactionId}:${input.amountMinor}`,
    });

    if (result.status === 'FAILED') {
      throw new DomainError('PROVIDER_ERROR', `Refund failed: ${result.failureCode ?? 'unknown'}`);
    }

    const refund = await tx.refund.create({
      data: {
        transactionId: transaction.id,
        paymentId: payment.id,
        amountMinor: input.amountMinor,
        currency: payment.currency,
        reason: input.reason,
        status: 'COMPLETED',
        providerRef: result.refundRef,
        requestedBy: input.requestedBy,
        completedAt: new Date(),
      },
      select: { id: true },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedMinor: { increment: input.amountMinor },
        status:
          payment.refundedMinor + input.amountMinor >= payment.capturedMinor
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED',
      },
    });

    // Unwind the whole chain: fees given back, FX position closed, payout
    // obligation cancelled, funds returned via the processor.
    await reverseAllPostingsForTransaction(
      transaction.id,
      { reason: input.reason, eventType: 'REFUND' },
      tx,
    );

    await transitionTransaction(
      {
        transactionId: transaction.id,
        to: 'REFUNDED',
        actorType: 'admin',
        actorId: input.requestedBy,
        reason: input.reason,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: input.requestedBy,
        actorType: 'admin',
        action: 'refund.issue',
        resourceType: 'refund',
        resourceId: refund.id,
        after: { amountMinor: input.amountMinor.toString(), reason: input.reason },
        ipAddress: input.ipAddress,
      },
      tx,
    );

    return { refundId: refund.id };
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Process a provider webhook.
 *
 * Three guards, in order: the signature must verify, the timestamp must be inside
 * the tolerance window (both handled by the provider), and the provider's event id
 * must not have been seen before. Only then is the event acted upon.
 */
export async function handlePaymentWebhook(input: {
  rawBody: string;
  headers: Record<string, string>;
}): Promise<{ handled: boolean; reason?: string }> {
  const provider = getPaymentProvider();
  const signature = provider.verifyWebhookSignature(input.rawBody, input.headers);

  if (!signature.valid) {
    await prisma.webhookEvent.create({
      data: {
        provider: provider.name,
        externalId: `invalid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        eventType: 'unknown',
        status: 'INVALID_SIGNATURE',
        signatureValid: false,
        payload: safeParse(input.rawBody),
        error: signature.reason ?? 'Signature verification failed',
      },
    });
    throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature verification failed');
  }

  const event = provider.parseWebhook(input.rawBody);

  // Replay guard: the unique constraint on (provider, externalId) is the real
  // enforcement; this read just avoids the exception in the common case.
  const seen = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { provider: provider.name, externalId: event.externalId } },
    select: { id: true, status: true },
  });
  if (seen) {
    return { handled: false, reason: 'Duplicate event, already processed' };
  }

  const record = await prisma.webhookEvent.create({
    data: {
      provider: provider.name,
      externalId: event.externalId,
      eventType: event.type,
      status: 'RECEIVED',
      signatureValid: true,
      payload: safeParse(input.rawBody),
    },
    select: { id: true },
  });

  try {
    const payment = await prisma.payment.findFirst({
      where: { provider: provider.name, providerRef: event.providerRef },
      include: { transaction: true },
    });

    if (!payment) {
      await prisma.webhookEvent.update({
        where: { id: record.id },
        data: { status: 'IGNORED', processedAt: new Date(), error: 'No matching payment' },
      });
      return { handled: false, reason: 'No matching payment' };
    }

    if (event.type === 'payment.chargeback') {
      await recordChargeback({
        transactionId: payment.transactionId,
        paymentId: payment.id,
        amountMinor: event.amountMinor,
        currency: event.currency,
        reasonCode: String(event.data.reasonCode ?? 'unknown'),
      });
    }

    await prisma.webhookEvent.update({
      where: { id: record.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });

    return { handled: true };
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id: record.id },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
        attemptCount: { increment: 1 },
      },
    });
    throw error;
  }
}

function safeParse(raw: string): object {
  try {
    return JSON.parse(raw) as object;
  } catch {
    return { unparsed: raw.slice(0, 1000) };
  }
}

/**
 * Record a chargeback.
 *
 * When cash was already disbursed the loss is booked to the fraud expense account
 * — the ledger states plainly that the money is gone. That number is the single
 * most important input to the risk model.
 */
export async function recordChargeback(input: {
  transactionId: string;
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  reasonCode: string;
  networkCaseRef?: string;
}): Promise<{ chargebackId: string }> {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      select: { id: true, reference: true, status: true, paidOutMinor: true },
    });
    if (!transaction) throw new DomainError('TRANSACTION_NOT_FOUND', 'Transaction not found');

    const cashAlreadyDisbursed = transaction.paidOutMinor > 0n;

    const chargeback = await tx.chargeback.create({
      data: {
        transactionId: transaction.id,
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        reasonCode: input.reasonCode,
        networkCaseRef: input.networkCaseRef ?? null,
        status: 'RECEIVED',
        evidenceDueAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
      select: { id: true },
    });

    await tx.payment.update({
      where: { id: input.paymentId },
      data: { status: 'CHARGEBACK' },
    });

    if (cashAlreadyDisbursed) {
      // The pesos are gone and the payout obligation was already discharged to
      // the partner. This is a straight, unrecoverable loss, and the ledger says
      // so plainly — this number is the most important input to the risk model.
      await postLedgerTransaction(
        buildChargebackPosting({
          transactionRef: transaction.reference,
          chargebackAmount: fromMinor(input.amountMinor, input.currency),
          chargebackId: chargeback.id,
          cashAlreadyDisbursed: true,
        }),
        { transactionId: transaction.id },
        tx,
      );
    } else {
      // Nothing was disbursed, so the value is still held in the FX position and
      // the payout liability. Unwind the chain rather than debiting a suspense
      // account that no longer holds these funds.
      await reverseAllPostingsForTransaction(
        transaction.id,
        { reason: `Chargeback ${input.reasonCode}`, eventType: 'CHARGEBACK' },
        tx,
      );
    }

    if (transaction.status === 'PICKED_UP') {
      await transitionTransaction(
        {
          transactionId: transaction.id,
          to: 'DISPUTED',
          actorType: 'webhook',
          reason: `Chargeback received: ${input.reasonCode}`,
        },
        tx,
      );
    }

    await tx.fraudAlert.create({
      data: {
        alertNumber: generateReference('ALT'),
        type: 'CHARGEBACK_PATTERN',
        severity: cashAlreadyDisbursed ? 'CRITICAL' : 'HIGH',
        status: 'OPEN',
        transactionId: transaction.id,
        description: cashAlreadyDisbursed
          ? 'Chargeback received after cash was disbursed — unrecoverable loss'
          : 'Chargeback received before disbursement',
        evidence: { reasonCode: input.reasonCode, amountMinor: input.amountMinor.toString() },
      },
    });

    await writeAudit(
      {
        actorType: 'webhook',
        action: 'chargeback.record',
        resourceType: 'chargeback',
        resourceId: chargeback.id,
        after: {
          transactionId: transaction.id,
          amountMinor: input.amountMinor.toString(),
          cashAlreadyDisbursed,
        },
      },
      tx,
    );

    return { chargebackId: chargeback.id };
  });
}

export { env as paymentEnv };
