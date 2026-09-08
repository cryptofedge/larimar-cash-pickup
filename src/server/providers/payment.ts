/**
 * Payment provider port.
 *
 * THE CARDINAL RULE: no primary account number, CVV, expiry, or magnetic-stripe
 * data ever enters this application. The client exchanges card details directly
 * with the provider's hosted fields using a client secret, and hands us back an
 * opaque token. Everything below operates on tokens.
 *
 * `MockPaymentProvider` deliberately mimics the full shape of a real integration
 * — client secrets, declines with network reason codes, 3-D Secure challenge,
 * asynchronous webhook confirmation, partial refunds — so that installing a real
 * provider is an implementation swap rather than a redesign.
 *
 * IMPORTANT: the mock moves no money. It cannot. See docs/LEGAL_AND_COMPLIANCE.md
 * for what must be true before a real provider can be connected.
 */

import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { buildSignature, verifySignature } from '../auth/crypto';

export type PaymentProviderStatus =
  | 'CREATED'
  | 'REQUIRES_ACTION'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export interface CreatePaymentInput {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly reference: string;
  readonly customerRef: string;
  readonly description: string;
  readonly idempotencyKey: string;
  readonly metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  readonly providerRef: string;
  readonly status: PaymentProviderStatus;
  /** Handed to the browser so it can talk to the provider directly. Never a secret we store. */
  readonly clientSecret: string;
}

export interface AuthorizePaymentInput {
  readonly providerRef: string;
  /** Opaque token from the provider's hosted fields. NEVER a PAN. */
  readonly paymentToken: string;
  readonly idempotencyKey: string;
}

export interface CardDetails {
  readonly brand: string;
  readonly last4: string;
  readonly bin: string;
  readonly country: string;
  readonly methodType: 'CARD_DEBIT' | 'CARD_CREDIT';
}

export interface PaymentAuthorizationResult {
  readonly providerRef: string;
  readonly status: PaymentProviderStatus;
  readonly card?: CardDetails;
  readonly threeDsResult?: string;
  /** Present when status is REQUIRES_ACTION. */
  readonly actionUrl?: string;
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

export interface CapturePaymentInput {
  readonly providerRef: string;
  readonly amountMinor: bigint;
  readonly idempotencyKey: string;
}

export interface PaymentCaptureResult {
  readonly providerRef: string;
  readonly status: PaymentProviderStatus;
  readonly capturedMinor: bigint;
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

export interface RefundPaymentInput {
  readonly providerRef: string;
  readonly amountMinor: bigint;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface PaymentRefundResult {
  readonly refundRef: string;
  readonly status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  readonly refundedMinor: bigint;
  readonly failureCode?: string;
}

export interface PaymentStatusResult {
  readonly providerRef: string;
  readonly status: PaymentProviderStatus;
  readonly capturedMinor: bigint;
  readonly refundedMinor: bigint;
}

export interface PaymentWebhookEvent {
  readonly externalId: string;
  readonly type:
    | 'payment.authorized'
    | 'payment.captured'
    | 'payment.failed'
    | 'payment.refunded'
    | 'payment.chargeback';
  readonly providerRef: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly occurredAt: Date;
  readonly data: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentIntentResult>;
  authorizePayment(input: AuthorizePaymentInput): Promise<PaymentAuthorizationResult>;
  capturePayment(input: CapturePaymentInput): Promise<PaymentCaptureResult>;
  refundPayment(input: RefundPaymentInput): Promise<PaymentRefundResult>;
  getPaymentStatus(providerRef: string): Promise<PaymentStatusResult>;
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): { valid: boolean; reason?: string };
  parseWebhook(rawBody: string): PaymentWebhookEvent;
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

/**
 * Scenario tokens. The demo checkout offers these as selectable outcomes so the
 * whole decline and challenge surface can be exercised without a real processor.
 */
export const MOCK_TOKENS = {
  SUCCESS_DEBIT: 'tok_demo_visa_debit_ok',
  SUCCESS_CREDIT: 'tok_demo_mc_credit_ok',
  DECLINE_FUNDS: 'tok_demo_decline_insufficient_funds',
  DECLINE_FRAUD: 'tok_demo_decline_suspected_fraud',
  DECLINE_EXPIRED: 'tok_demo_decline_expired_card',
  REQUIRES_3DS: 'tok_demo_requires_3ds',
  FOREIGN_HIGH_RISK: 'tok_demo_foreign_high_risk',
} as const;

interface MockRecord {
  providerRef: string;
  amountMinor: bigint;
  currency: string;
  status: PaymentProviderStatus;
  capturedMinor: bigint;
  refundedMinor: bigint;
  card?: CardDetails;
}

const CARD_PROFILES: Record<string, CardDetails> = {
  [MOCK_TOKENS.SUCCESS_DEBIT]: { brand: 'Visa', last4: '4242', bin: '424242', country: 'US', methodType: 'CARD_DEBIT' },
  [MOCK_TOKENS.SUCCESS_CREDIT]: { brand: 'Mastercard', last4: '5454', bin: '545454', country: 'US', methodType: 'CARD_CREDIT' },
  [MOCK_TOKENS.DECLINE_FUNDS]: { brand: 'Visa', last4: '0002', bin: '400000', country: 'US', methodType: 'CARD_DEBIT' },
  [MOCK_TOKENS.DECLINE_FRAUD]: { brand: 'Visa', last4: '0019', bin: '400000', country: 'US', methodType: 'CARD_CREDIT' },
  [MOCK_TOKENS.DECLINE_EXPIRED]: { brand: 'Visa', last4: '0069', bin: '400000', country: 'US', methodType: 'CARD_DEBIT' },
  [MOCK_TOKENS.REQUIRES_3DS]: { brand: 'Visa', last4: '3155', bin: '400000', country: 'GB', methodType: 'CARD_CREDIT' },
  [MOCK_TOKENS.FOREIGN_HIGH_RISK]: { brand: 'Visa', last4: '7777', bin: '400001', country: 'KP', methodType: 'CARD_CREDIT' },
};

/**
 * In-memory store. Sufficient for a demo and for tests; a real provider holds
 * this state on its own side, which is precisely why the interface never exposes
 * it.
 */
const store = new Map<string, MockRecord>();

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntentResult> {
    const providerRef = `pi_mock_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    store.set(providerRef, {
      providerRef,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: 'CREATED',
      capturedMinor: 0n,
      refundedMinor: 0n,
    });
    return {
      providerRef,
      status: 'CREATED',
      clientSecret: `${providerRef}_secret_${randomUUID().slice(0, 8)}`,
    };
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<PaymentAuthorizationResult> {
    const record = store.get(input.providerRef);
    if (!record) {
      return {
        providerRef: input.providerRef,
        status: 'FAILED',
        failureCode: 'payment_intent_not_found',
        failureMessage: 'No such payment intent',
      };
    }

    // Guard against a token that looks like raw card data. A real integration
    // could never receive one, but the assertion documents the boundary and
    // fails loudly if someone wires the client up incorrectly.
    if (/^\d{12,19}$/.test(input.paymentToken.replace(/[\s-]/g, ''))) {
      throw new Error(
        'Refusing a value that looks like a card number. Card data must never reach this application.',
      );
    }

    const card = CARD_PROFILES[input.paymentToken];

    if (input.paymentToken === MOCK_TOKENS.DECLINE_FUNDS) {
      record.status = 'FAILED';
      return { providerRef: record.providerRef, status: 'FAILED', card, failureCode: 'insufficient_funds', failureMessage: 'The card has insufficient funds' };
    }
    if (input.paymentToken === MOCK_TOKENS.DECLINE_FRAUD) {
      record.status = 'FAILED';
      return { providerRef: record.providerRef, status: 'FAILED', card, failureCode: 'suspected_fraud', failureMessage: 'The issuer declined the charge as suspected fraud' };
    }
    if (input.paymentToken === MOCK_TOKENS.DECLINE_EXPIRED) {
      record.status = 'FAILED';
      return { providerRef: record.providerRef, status: 'FAILED', card, failureCode: 'expired_card', failureMessage: 'The card has expired' };
    }
    if (input.paymentToken === MOCK_TOKENS.REQUIRES_3DS) {
      record.status = 'REQUIRES_ACTION';
      return {
        providerRef: record.providerRef,
        status: 'REQUIRES_ACTION',
        card,
        threeDsResult: 'challenge_required',
        actionUrl: `/demo/3ds-challenge?intent=${record.providerRef}`,
      };
    }

    if (!card) {
      record.status = 'FAILED';
      return { providerRef: record.providerRef, status: 'FAILED', failureCode: 'invalid_token', failureMessage: 'Unrecognised payment token' };
    }

    record.status = 'AUTHORIZED';
    record.card = card;
    return { providerRef: record.providerRef, status: 'AUTHORIZED', card, threeDsResult: 'frictionless' };
  }

  async capturePayment(input: CapturePaymentInput): Promise<PaymentCaptureResult> {
    const record = store.get(input.providerRef);
    if (!record) {
      return { providerRef: input.providerRef, status: 'FAILED', capturedMinor: 0n, failureCode: 'payment_intent_not_found' };
    }
    if (record.status === 'CAPTURED') {
      // Idempotent: capturing twice returns the original result rather than
      // charging again.
      return { providerRef: record.providerRef, status: 'CAPTURED', capturedMinor: record.capturedMinor };
    }
    if (record.status !== 'AUTHORIZED') {
      return { providerRef: record.providerRef, status: record.status, capturedMinor: record.capturedMinor, failureCode: 'not_authorized', failureMessage: `Cannot capture from status ${record.status}` };
    }
    if (input.amountMinor > record.amountMinor) {
      return { providerRef: record.providerRef, status: 'AUTHORIZED', capturedMinor: 0n, failureCode: 'capture_exceeds_authorization' };
    }

    record.status = 'CAPTURED';
    record.capturedMinor = input.amountMinor;
    return { providerRef: record.providerRef, status: 'CAPTURED', capturedMinor: record.capturedMinor };
  }

  async refundPayment(input: RefundPaymentInput): Promise<PaymentRefundResult> {
    const record = store.get(input.providerRef);
    if (!record) {
      return { refundRef: '', status: 'FAILED', refundedMinor: 0n, failureCode: 'payment_intent_not_found' };
    }
    const remaining = record.capturedMinor - record.refundedMinor;
    if (input.amountMinor > remaining) {
      return { refundRef: '', status: 'FAILED', refundedMinor: 0n, failureCode: 'refund_exceeds_captured' };
    }

    record.refundedMinor += input.amountMinor;
    record.status = record.refundedMinor === record.capturedMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    return {
      refundRef: `re_mock_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      status: 'COMPLETED',
      refundedMinor: input.amountMinor,
    };
  }

  async getPaymentStatus(providerRef: string): Promise<PaymentStatusResult> {
    const record = store.get(providerRef);
    if (!record) {
      return { providerRef, status: 'FAILED', capturedMinor: 0n, refundedMinor: 0n };
    }
    return {
      providerRef,
      status: record.status,
      capturedMinor: record.capturedMinor,
      refundedMinor: record.refundedMinor,
    };
  }

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
  ): { valid: boolean; reason?: string } {
    const signature = headers['x-larimar-signature'] ?? headers['X-Larimar-Signature'];
    const timestamp = headers['x-larimar-timestamp'] ?? headers['X-Larimar-Timestamp'];
    if (!signature || !timestamp) {
      return { valid: false, reason: 'Missing signature or timestamp header' };
    }
    return verifySignature({
      payload: rawBody,
      timestamp,
      signature,
      secret: env.PAYMENT_WEBHOOK_SECRET,
      toleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS,
    });
  }

  parseWebhook(rawBody: string): PaymentWebhookEvent {
    const parsed = JSON.parse(rawBody) as {
      id: string;
      type: PaymentWebhookEvent['type'];
      providerRef: string;
      amountMinor: string | number;
      currency: string;
      occurredAt: string;
      data?: Record<string, unknown>;
    };

    return {
      externalId: parsed.id,
      type: parsed.type,
      providerRef: parsed.providerRef,
      amountMinor: BigInt(parsed.amountMinor),
      currency: parsed.currency,
      occurredAt: new Date(parsed.occurredAt),
      data: parsed.data ?? {},
    };
  }

  /** Test helper: build a correctly signed webhook body and headers. */
  static signWebhook(body: Record<string, unknown>): {
    rawBody: string;
    headers: Record<string, string>;
  } {
    const rawBody = JSON.stringify(body);
    const { timestamp, signature } = buildSignature(rawBody, env.PAYMENT_WEBHOOK_SECRET);
    return {
      rawBody,
      headers: {
        'x-larimar-signature': signature,
        'x-larimar-timestamp': timestamp,
        'content-type': 'application/json',
      },
    };
  }

  /** Test helper only. */
  static reset(): void {
    store.clear();
  }
}

let instance: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance;

  switch (env.PAYMENT_PROVIDER) {
    case 'mock':
      instance = new MockPaymentProvider();
      return instance;
    default:
      // Reaching here means someone configured a provider that has no
      // implementation. Failing loudly is the only safe behaviour.
      throw new Error(
        `No PaymentProvider implementation for "${env.PAYMENT_PROVIDER}". ` +
          'Implement the PaymentProvider interface and register it here. ' +
          'See docs/PARTNER_INTEGRATION.md.',
      );
  }
}

/** Test helper. */
export function resetPaymentProvider(): void {
  instance = null;
  MockPaymentProvider.reset();
}
