/**
 * Domain errors.
 *
 * Every failure the domain can express is a stable machine-readable `code`. The
 * HTTP layer maps codes to statuses in exactly one place, so a caller never sees
 * a stack trace, a Prisma message, or a leaked table name. Nothing here contains
 * personally identifying information or secrets — error strings end up in logs.
 */

export type DomainErrorCode =
  // money / pricing
  | 'INVALID_MONEY'
  | 'UNSUPPORTED_CURRENCY'
  | 'CURRENCY_MISMATCH'
  | 'DIVISION_BY_ZERO'
  | 'INVALID_ROUNDING_MODE'
  | 'INVALID_BPS'
  | 'INVALID_ALLOCATION'
  | 'INVALID_RATE'
  | 'RATE_UNAVAILABLE'
  | 'RATE_EXPIRED'
  | 'RATE_DRIFTED'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_ALREADY_USED'
  | 'AMOUNT_BELOW_MINIMUM'
  | 'AMOUNT_ABOVE_MAXIMUM'
  // state machine
  | 'ILLEGAL_STATE_TRANSITION'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_TERMINAL'
  // pickup
  | 'PICKUP_CODE_INVALID'
  | 'PICKUP_CODE_EXPIRED'
  | 'PICKUP_CODE_LOCKED'
  | 'PICKUP_CODE_ALREADY_REDEEMED'
  | 'PICKUP_CODE_ATTEMPTS_EXCEEDED'
  | 'PICKUP_NOT_READY'
  | 'PICKUP_LOCATION_UNAVAILABLE'
  | 'PICKUP_LOCATION_CAPACITY'
  // ledger
  | 'LEDGER_UNBALANCED'
  | 'LEDGER_CURRENCY_MISMATCH'
  | 'LEDGER_DUPLICATE_POSTING'
  | 'LEDGER_INVALID_ENTRY'
  // compliance / risk
  | 'KYC_REQUIRED'
  | 'KYC_REJECTED'
  | 'LIMIT_EXCEEDED_DAILY'
  | 'LIMIT_EXCEEDED_MONTHLY'
  | 'LIMIT_EXCEEDED_VELOCITY'
  | 'COMPLIANCE_HOLD'
  | 'SANCTIONS_MATCH'
  | 'RISK_BLOCKED'
  // payments
  | 'PAYMENT_FAILED'
  | 'PAYMENT_ALREADY_CAPTURED'
  | 'PAYMENT_NOT_AUTHORIZED'
  | 'REFUND_EXCEEDS_CAPTURED'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_REPLAY'
  // access
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'MFA_REQUIRED'
  | 'ACCOUNT_LOCKED'
  | 'INVALID_CREDENTIALS'
  | 'SESSION_EXPIRED'
  // infrastructure / request
  | 'VALIDATION_ERROR'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CONFIGURATION_ERROR'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR'
  | 'UNSUPPORTED_COUNTRY';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}

/** An attempt to move a transaction along an edge the state machine does not have. */
export class IllegalTransitionError extends DomainError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(
      'ILLEGAL_STATE_TRANSITION',
      `Transition ${from} -> ${to} is not permitted by the transaction state machine`,
      { from, to },
    );
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
    Object.setPrototypeOf(this, IllegalTransitionError.prototype);
  }
}

/** A ledger posting whose entries do not sum to zero. Never reaches the database. */
export class LedgerImbalanceError extends DomainError {
  constructor(imbalanceMinor: bigint, currency: string) {
    super(
      'LEDGER_UNBALANCED',
      `Ledger transaction is out of balance by ${imbalanceMinor} ${currency} minor units`,
      { imbalanceMinor: imbalanceMinor.toString(), currency },
    );
    this.name = 'LedgerImbalanceError';
    Object.setPrototypeOf(this, LedgerImbalanceError.prototype);
  }
}

const STATUS_BY_CODE: Partial<Record<DomainErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  MFA_REQUIRED: 401,
  FORBIDDEN: 403,
  ACCOUNT_LOCKED: 403,
  COMPLIANCE_HOLD: 403,
  RISK_BLOCKED: 403,
  SANCTIONS_MATCH: 403,
  KYC_REQUIRED: 403,
  KYC_REJECTED: 403,
  NOT_FOUND: 404,
  TRANSACTION_NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PICKUP_CODE_ALREADY_REDEEMED: 409,
  LEDGER_DUPLICATE_POSTING: 409,
  QUOTE_ALREADY_USED: 409,
  ILLEGAL_STATE_TRANSITION: 409,
  TRANSACTION_TERMINAL: 409,
  PAYMENT_ALREADY_CAPTURED: 409,
  QUOTE_EXPIRED: 410,
  RATE_EXPIRED: 410,
  PICKUP_CODE_EXPIRED: 410,
  VALIDATION_ERROR: 422,
  AMOUNT_BELOW_MINIMUM: 422,
  AMOUNT_ABOVE_MAXIMUM: 422,
  LIMIT_EXCEEDED_DAILY: 422,
  LIMIT_EXCEEDED_MONTHLY: 422,
  LIMIT_EXCEEDED_VELOCITY: 429,
  RATE_LIMITED: 429,
  PICKUP_CODE_ATTEMPTS_EXCEEDED: 429,
  WEBHOOK_SIGNATURE_INVALID: 400,
  WEBHOOK_REPLAY: 400,
  PROVIDER_ERROR: 502,
  RATE_UNAVAILABLE: 503,
  CONFIGURATION_ERROR: 500,
  INTERNAL_ERROR: 500,
};

/** Codes 4xx are safe to echo to a client; 5xx get a generic message instead. */
export function httpStatusForCode(code: DomainErrorCode): number {
  return STATUS_BY_CODE[code] ?? 400;
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
