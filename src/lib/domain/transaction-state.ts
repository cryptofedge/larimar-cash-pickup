/**
 * The transaction state machine.
 *
 * A transaction status is never assigned directly. Every change goes through
 * `assertTransition`, which consults a declarative matrix. That matrix is data,
 * which means the legal paths through the system can be enumerated, tested
 * exhaustively, and rendered in documentation without reading imperative code.
 *
 * The second layer is actor authority: knowing that PAYMENT_AUTHORIZED can reach
 * READY_FOR_PICKUP is not enough — a customer must not be able to make that
 * transition happen. Each edge names the actor types permitted to traverse it.
 */

import { IllegalTransitionError } from './errors';

export const TRANSACTION_STATUSES = [
  'CREATED',
  'CUSTOMER_DETAILS_REQUIRED',
  'KYC_REQUIRED',
  'KYC_PENDING',
  'KYC_APPROVED',
  'KYC_REJECTED',
  'PAYMENT_PENDING',
  'PAYMENT_AUTHORIZED',
  'PAYMENT_FAILED',
  'COMPLIANCE_REVIEW',
  'READY_FOR_PICKUP',
  'PARTIALLY_PICKED_UP',
  'PICKED_UP',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
  'DISPUTED',
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/**
 * Who may drive a transition.
 *
 * `system` covers scheduled jobs and internal orchestration; `webhook` covers
 * verified provider callbacks. Note that `customer` appears on very few edges —
 * essentially only "start" and "give up" — which is the point.
 */
export type ActorType = 'system' | 'customer' | 'agent' | 'compliance' | 'admin' | 'webhook';

export interface TransitionRule {
  readonly to: TransactionStatus;
  readonly actors: readonly ActorType[];
  readonly description: string;
}

const T = (to: TransactionStatus, actors: readonly ActorType[], description: string): TransitionRule =>
  Object.freeze({ to, actors, description });

/**
 * The complete legal transition matrix. If an edge is not here, it cannot happen.
 */
export const TRANSITIONS: Readonly<Record<TransactionStatus, readonly TransitionRule[]>> =
  Object.freeze({
    CREATED: [
      T('CUSTOMER_DETAILS_REQUIRED', ['system'], 'Profile data missing before pricing can be locked'),
      T('KYC_REQUIRED', ['system'], 'Amount or risk requires identity verification'),
      T('PAYMENT_PENDING', ['system', 'customer'], 'Customer proceeds to fund the transaction'),
      T('CANCELLED', ['customer', 'system', 'admin'], 'Abandoned or withdrawn before funding'),
      T('EXPIRED', ['system'], 'Quote lapsed before the customer proceeded'),
    ],

    CUSTOMER_DETAILS_REQUIRED: [
      T('KYC_REQUIRED', ['system'], 'Details supplied; identity verification still required'),
      T('PAYMENT_PENDING', ['system'], 'Details supplied and no verification required'),
      T('CANCELLED', ['customer', 'system', 'admin'], 'Abandoned'),
      T('EXPIRED', ['system'], 'Quote lapsed'),
    ],

    KYC_REQUIRED: [
      T('KYC_PENDING', ['system', 'customer'], 'Documents submitted to the verification provider'),
      T('CANCELLED', ['customer', 'system', 'admin'], 'Abandoned'),
      T('EXPIRED', ['system'], 'Quote lapsed'),
    ],

    KYC_PENDING: [
      T('KYC_APPROVED', ['webhook', 'compliance', 'system'], 'Verification passed'),
      T('KYC_REJECTED', ['webhook', 'compliance', 'system'], 'Verification failed'),
      T('COMPLIANCE_REVIEW', ['system', 'compliance'], 'Verification inconclusive; manual review'),
      T('EXPIRED', ['system'], 'Verification not completed in time'),
    ],

    KYC_APPROVED: [
      T('PAYMENT_PENDING', ['system', 'customer'], 'Cleared to fund'),
      T('CANCELLED', ['customer', 'system', 'admin'], 'Abandoned after approval'),
      T('EXPIRED', ['system'], 'Quote lapsed'),
    ],

    // A rejected verification cannot be funded. It is closed out, never funded.
    KYC_REJECTED: [
      T('CANCELLED', ['system', 'compliance', 'admin'], 'Closed out after rejection'),
    ],

    PAYMENT_PENDING: [
      T('PAYMENT_AUTHORIZED', ['webhook', 'system'], 'Provider authorised the charge'),
      T('PAYMENT_FAILED', ['webhook', 'system'], 'Provider declined the charge'),
      T('CANCELLED', ['customer', 'system', 'admin'], 'Customer abandoned checkout'),
      T('EXPIRED', ['system'], 'Payment window lapsed'),
    ],

    PAYMENT_AUTHORIZED: [
      T('COMPLIANCE_REVIEW', ['system', 'compliance'], 'Risk score or rule requires manual review'),
      T('READY_FOR_PICKUP', ['system'], 'Cleared automatically; pickup code issued'),
      T('REFUNDED', ['admin', 'compliance', 'system'], 'Funds returned before any payout'),
      T('CANCELLED', ['admin', 'compliance'], 'Voided before capture'),
    ],

    PAYMENT_FAILED: [
      T('PAYMENT_PENDING', ['customer', 'system'], 'Customer retries with another method'),
      T('CANCELLED', ['customer', 'system', 'admin'], 'Given up after failure'),
      T('EXPIRED', ['system'], 'No retry within the window'),
    ],

    COMPLIANCE_REVIEW: [
      T('READY_FOR_PICKUP', ['compliance'], 'Analyst released the hold'),
      T('KYC_REQUIRED', ['compliance'], 'Analyst requires further identity evidence'),
      T('REFUNDED', ['compliance', 'admin'], 'Rejected on review; funds returned'),
      T('CANCELLED', ['compliance', 'admin'], 'Rejected on review before capture'),
    ],

    READY_FOR_PICKUP: [
      T('PARTIALLY_PICKED_UP', ['agent', 'system'], 'Partial cash disbursed at the window'),
      T('PICKED_UP', ['agent', 'system'], 'Full amount disbursed'),
      T('COMPLIANCE_REVIEW', ['compliance', 'system'], 'Post-issue hold placed'),
      T('EXPIRED', ['system'], 'Pickup code expired unredeemed'),
      T('CANCELLED', ['admin', 'compliance'], 'Withdrawn before collection'),
      T('REFUNDED', ['admin', 'compliance'], 'Returned to the customer instead of paid out'),
    ],

    PARTIALLY_PICKED_UP: [
      T('PICKED_UP', ['agent', 'system'], 'Remaining balance disbursed'),
      T('COMPLIANCE_REVIEW', ['compliance', 'system'], 'Hold placed mid-disbursement'),
      T('EXPIRED', ['system'], 'Remainder never collected'),
      T('REFUNDED', ['admin', 'compliance'], 'Remainder returned to the customer'),
    ],

    // Cash is gone. A chargeback can still arrive — that is the defining risk of
    // this product and the model must admit it rather than pretend otherwise.
    PICKED_UP: [
      T('DISPUTED', ['webhook', 'admin'], 'Chargeback received after disbursement'),
      T('REFUNDED', ['admin'], 'Goodwill or error refund after disbursement'),
    ],

    EXPIRED: [T('REFUNDED', ['system', 'admin'], 'Unredeemed funds returned')],

    CANCELLED: [T('REFUNDED', ['system', 'admin'], 'Funds returned after cancellation')],

    // REFUNDED is the single absorbing state: the customer has their money back
    // and the transaction is closed.
    //
    // A chargeback can still arrive after a refund in the real world, but it is
    // deliberately NOT modelled as a transition back into DISPUTED. Reopening a
    // closed transaction would create a path from KYC_REJECTED -> CANCELLED ->
    // REFUNDED -> DISPUTED -> PICKED_UP, i.e. a rejected customer reaching a
    // cash-disbursed state. A post-refund chargeback is tracked on the
    // Chargeback record, which exists independently of transaction status.
    REFUNDED: [],

    DISPUTED: [
      T('REFUNDED', ['admin', 'webhook'], 'Dispute lost; funds returned to the issuer'),
      T('PICKED_UP', ['admin', 'webhook'], 'Dispute won; disbursement stands'),
    ],
  });

/** States from which nothing further can happen. */
export const TERMINAL_STATUSES: readonly TransactionStatus[] = Object.freeze(
  TRANSACTION_STATUSES.filter((s) => TRANSITIONS[s].length === 0),
);

/** States in which customer funds are held by the platform and are at risk. */
export const FUNDS_HELD_STATUSES: readonly TransactionStatus[] = Object.freeze([
  'PAYMENT_AUTHORIZED',
  'COMPLIANCE_REVIEW',
  'READY_FOR_PICKUP',
  'PARTIALLY_PICKED_UP',
] as const);

/** States in which a valid pickup code should exist and be presentable. */
export const REDEEMABLE_STATUSES: readonly TransactionStatus[] = Object.freeze([
  'READY_FOR_PICKUP',
  'PARTIALLY_PICKED_UP',
] as const);

export function isValidStatus(value: string): value is TransactionStatus {
  return (TRANSACTION_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: TransactionStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function isRedeemable(status: TransactionStatus): boolean {
  return REDEEMABLE_STATUSES.includes(status);
}

export function areFundsHeld(status: TransactionStatus): boolean {
  return FUNDS_HELD_STATUSES.includes(status);
}

export function allowedTransitions(from: TransactionStatus): readonly TransitionRule[] {
  return TRANSITIONS[from];
}

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return TRANSITIONS[from].some((rule) => rule.to === to);
}

export function canActorTransition(
  from: TransactionStatus,
  to: TransactionStatus,
  actor: ActorType,
): boolean {
  const rule = TRANSITIONS[from].find((r) => r.to === to);
  return rule !== undefined && rule.actors.includes(actor);
}

/**
 * The only sanctioned way to change a transaction's status.
 *
 * Throws rather than returning a boolean, because a caller who forgets to check
 * a returned flag would silently corrupt financial state. An exception cannot be
 * ignored by accident.
 */
export function assertTransition(
  from: TransactionStatus,
  to: TransactionStatus,
  actor: ActorType,
): void {
  const rule = TRANSITIONS[from].find((r) => r.to === to);
  if (!rule) {
    throw new IllegalTransitionError(from, to);
  }
  if (!rule.actors.includes(actor)) {
    throw new IllegalTransitionError(from, to);
  }
}

export function describeTransition(
  from: TransactionStatus,
  to: TransactionStatus,
): string | undefined {
  return TRANSITIONS[from].find((r) => r.to === to)?.description;
}

/**
 * Shortest legal path between two states, or null if unreachable.
 * Used by the admin console to explain what would have to happen next, and by
 * tests to assert that the graph has no unreachable states.
 */
export function findPath(
  from: TransactionStatus,
  to: TransactionStatus,
): TransactionStatus[] | null {
  if (from === to) return [from];

  const queue: TransactionStatus[][] = [[from]];
  const seen = new Set<TransactionStatus>([from]);

  while (queue.length > 0) {
    const path = queue.shift() as TransactionStatus[];
    const tail = path[path.length - 1] as TransactionStatus;

    for (const rule of TRANSITIONS[tail]) {
      if (seen.has(rule.to)) continue;
      const next = [...path, rule.to];
      if (rule.to === to) return next;
      seen.add(rule.to);
      queue.push(next);
    }
  }

  return null;
}

/** Customer-facing status copy keys. Resolved through i18n, never hardcoded. */
export const STATUS_MESSAGE_KEYS: Readonly<Record<TransactionStatus, string>> = Object.freeze({
  CREATED: 'status.created',
  CUSTOMER_DETAILS_REQUIRED: 'status.customerDetailsRequired',
  KYC_REQUIRED: 'status.kycRequired',
  KYC_PENDING: 'status.kycPending',
  KYC_APPROVED: 'status.kycApproved',
  KYC_REJECTED: 'status.kycRejected',
  PAYMENT_PENDING: 'status.paymentPending',
  PAYMENT_AUTHORIZED: 'status.paymentAuthorized',
  PAYMENT_FAILED: 'status.paymentFailed',
  COMPLIANCE_REVIEW: 'status.complianceReview',
  READY_FOR_PICKUP: 'status.readyForPickup',
  PARTIALLY_PICKED_UP: 'status.partiallyPickedUp',
  PICKED_UP: 'status.pickedUp',
  EXPIRED: 'status.expired',
  CANCELLED: 'status.cancelled',
  REFUNDED: 'status.refunded',
  DISPUTED: 'status.disputed',
});
