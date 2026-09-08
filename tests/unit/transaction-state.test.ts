import { describe, expect, it } from 'vitest';
import {
  TERMINAL_STATUSES,
  TRANSACTION_STATUSES,
  TRANSITIONS,
  type TransactionStatus,
  areFundsHeld,
  assertTransition,
  canActorTransition,
  canTransition,
  findPath,
  isRedeemable,
  isTerminal,
  isValidStatus,
  STATUS_MESSAGE_KEYS,
} from '@/lib/domain/transaction-state';
import { IllegalTransitionError } from '@/lib/domain/errors';

describe('state machine shape', () => {
  it('test_state_machine_shape_declares_all_17_statuses', () => {
    expect(TRANSACTION_STATUSES).toHaveLength(17);
  });

  it('test_state_machine_shape_has_a_transition_entry_for_every_status', () => {
    for (const status of TRANSACTION_STATUSES) {
      expect(TRANSITIONS[status]).toBeDefined();
    }
  });

  it('test_state_machine_shape_never_targets_an_unknown_status', () => {
    for (const status of TRANSACTION_STATUSES) {
      for (const rule of TRANSITIONS[status]) {
        expect(isValidStatus(rule.to)).toBe(true);
      }
    }
  });

  it('test_state_machine_shape_has_no_self_transitions', () => {
    for (const status of TRANSACTION_STATUSES) {
      for (const rule of TRANSITIONS[status]) {
        expect(rule.to).not.toBe(status);
      }
    }
  });

  it('test_state_machine_shape_has_no_duplicate_edges', () => {
    for (const status of TRANSACTION_STATUSES) {
      const targets = TRANSITIONS[status].map((r) => r.to);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });

  it('test_state_machine_shape_names_at_least_one_permitted_actor_on_every_edge', () => {
    for (const status of TRANSACTION_STATUSES) {
      for (const rule of TRANSITIONS[status]) {
        expect(rule.actors.length).toBeGreaterThan(0);
        expect(rule.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('test_state_machine_shape_has_a_translation_key_for_every_status', () => {
    for (const status of TRANSACTION_STATUSES) {
      expect(STATUS_MESSAGE_KEYS[status]).toBeTruthy();
    }
  });
});

describe('reachability', () => {
  it('test_reachability_can_reach_every_non_initial_status_from_created', () => {
    for (const status of TRANSACTION_STATUSES) {
      if (status === 'CREATED') continue;
      expect(findPath('CREATED', status), `${status} is unreachable`).not.toBeNull();
    }
  });

  it('test_reachability_walks_the_happy_path_in_the_expected_order', () => {
    expect(findPath('CREATED', 'PICKED_UP')).toEqual([
      'CREATED',
      'PAYMENT_PENDING',
      'PAYMENT_AUTHORIZED',
      'READY_FOR_PICKUP',
      'PICKED_UP',
    ]);
  });

  it('test_reachability_returns_a_single_element_path_for_identity', () => {
    expect(findPath('CREATED', 'CREATED')).toEqual(['CREATED']);
  });
});

describe('terminal states', () => {
  it('test_terminal_states_identifies_exactly_the_states_with_no_outgoing_edges', () => {
    for (const status of TRANSACTION_STATUSES) {
      expect(isTerminal(status)).toBe(TRANSITIONS[status].length === 0);
    }
  });

  it('test_terminal_states_has_exactly_one_absorbing_state_so_transactions_actually_close', () => {
    expect(TERMINAL_STATUSES).toEqual(['REFUNDED']);
  });

  it('test_terminal_states_does_not_treat_picked_up_as_terminal_a_chargeback_can_still_arrive', () => {
    expect(isTerminal('PICKED_UP')).toBe(false);
    expect(canTransition('PICKED_UP', 'DISPUTED')).toBe(true);
  });
});

describe('the happy path is legal', () => {
  const path: [TransactionStatus, TransactionStatus][] = [
    ['CREATED', 'KYC_REQUIRED'],
    ['KYC_REQUIRED', 'KYC_PENDING'],
    ['KYC_PENDING', 'KYC_APPROVED'],
    ['KYC_APPROVED', 'PAYMENT_PENDING'],
    ['PAYMENT_PENDING', 'PAYMENT_AUTHORIZED'],
    ['PAYMENT_AUTHORIZED', 'READY_FOR_PICKUP'],
    ['READY_FOR_PICKUP', 'PICKED_UP'],
  ];

  it.each(path)('test_the_happy_path_is_legal_is_permitted [%s %s]', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });
});

describe('illegal transitions are refused', () => {
  it.each([
    ['CREATED', 'PICKED_UP'],
    ['CREATED', 'READY_FOR_PICKUP'],
    ['PAYMENT_PENDING', 'PICKED_UP'],
    ['KYC_REJECTED', 'PAYMENT_PENDING'],
    ['REFUNDED', 'READY_FOR_PICKUP'],
    ['PICKED_UP', 'READY_FOR_PICKUP'],
    ['EXPIRED', 'PICKED_UP'],
    ['CANCELLED', 'READY_FOR_PICKUP'],
  ] as [TransactionStatus, TransactionStatus][])('%s -> %s is rejected', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to, 'admin')).toThrow(IllegalTransitionError);
  });

  it('test_illegal_transitions_are_refused_a_rejected_kyc_can_never_reach_funding', () => {
    expect(findPath('KYC_REJECTED', 'PAYMENT_AUTHORIZED')).toBeNull();
    expect(findPath('KYC_REJECTED', 'PICKED_UP')).toBeNull();
  });
});

/**
 * Regression guard.
 *
 * An earlier revision allowed REFUNDED -> DISPUTED. Combined with
 * CANCELLED -> REFUNDED and DISPUTED -> PICKED_UP, that opened a path from
 * KYC_REJECTED all the way to PICKED_UP — a customer refused at identity
 * verification could reach a cash-disbursed state. These assertions exist so the
 * hole cannot reopen unnoticed.
 */
describe('soundness: closed-out transactions can never reach disbursement', () => {
  const closedOut: TransactionStatus[] = ['KYC_REJECTED', 'CANCELLED', 'EXPIRED', 'REFUNDED'];
  const disbursed: TransactionStatus[] = ['PICKED_UP', 'PARTIALLY_PICKED_UP', 'READY_FOR_PICKUP'];

  for (const from of closedOut) {
    for (const to of disbursed) {
      it(`test_soundness_closed_out_transactions_can_never_reach_disbursement_from_has_no_path_to_to`, () => {
        expect(findPath(from, to)).toBeNull();
      });
    }
  }

  it('test_soundness_closed_out_transactions_can_never_reach_disbursement_disputed_is_reachable_only_from_a_state_where_cash_actually_moved', () => {
    const predecessors = TRANSACTION_STATUSES.filter((s) =>
      TRANSITIONS[s].some((r) => r.to === 'DISPUTED'),
    );
    expect(predecessors).toEqual(['PICKED_UP']);
  });

  it('test_soundness_closed_out_transactions_can_never_reach_disbursement_no_closed_out_state_can_be_re_funded', () => {
    for (const from of closedOut) {
      expect(findPath(from, 'PAYMENT_AUTHORIZED')).toBeNull();
    }
  });
});

describe('actor authority — the defence against client-controlled state', () => {
  it('test_actor_authority_the_defence_against_client_controlled_state_forbids_a_customer_from_marking_their_own_transaction_ready_for_pickup', () => {
    expect(canTransition('PAYMENT_AUTHORIZED', 'READY_FOR_PICKUP')).toBe(true);
    expect(canActorTransition('PAYMENT_AUTHORIZED', 'READY_FOR_PICKUP', 'customer')).toBe(false);
    expect(() => assertTransition('PAYMENT_AUTHORIZED', 'READY_FOR_PICKUP', 'customer')).toThrow(
      IllegalTransitionError,
    );
  });

  it('test_actor_authority_the_defence_against_client_controlled_state_forbids_a_customer_from_completing_their_own_pickup', () => {
    expect(canActorTransition('READY_FOR_PICKUP', 'PICKED_UP', 'customer')).toBe(false);
    expect(canActorTransition('READY_FOR_PICKUP', 'PICKED_UP', 'agent')).toBe(true);
  });

  it('test_actor_authority_the_defence_against_client_controlled_state_forbids_an_agent_from_authorising_a_payment', () => {
    expect(canActorTransition('PAYMENT_PENDING', 'PAYMENT_AUTHORIZED', 'agent')).toBe(false);
    expect(canActorTransition('PAYMENT_PENDING', 'PAYMENT_AUTHORIZED', 'webhook')).toBe(true);
  });

  it('test_actor_authority_the_defence_against_client_controlled_state_forbids_an_agent_from_releasing_a_compliance_hold', () => {
    expect(canActorTransition('COMPLIANCE_REVIEW', 'READY_FOR_PICKUP', 'agent')).toBe(false);
    expect(canActorTransition('COMPLIANCE_REVIEW', 'READY_FOR_PICKUP', 'compliance')).toBe(true);
  });

  it('test_actor_authority_the_defence_against_client_controlled_state_lets_a_customer_cancel_before_funding_but_not_after_disbursement', () => {
    expect(canActorTransition('CREATED', 'CANCELLED', 'customer')).toBe(true);
    expect(canActorTransition('READY_FOR_PICKUP', 'CANCELLED', 'customer')).toBe(false);
  });

  it('test_actor_authority_the_defence_against_client_controlled_state_lets_a_customer_retry_a_failed_payment', () => {
    expect(canActorTransition('PAYMENT_FAILED', 'PAYMENT_PENDING', 'customer')).toBe(true);
  });
});

describe('funds-at-risk classification', () => {
  it('test_funds_at_risk_classification_marks_the_states_where_the_platform_holds_customer_money', () => {
    expect(areFundsHeld('PAYMENT_AUTHORIZED')).toBe(true);
    expect(areFundsHeld('COMPLIANCE_REVIEW')).toBe(true);
    expect(areFundsHeld('READY_FOR_PICKUP')).toBe(true);
    expect(areFundsHeld('PARTIALLY_PICKED_UP')).toBe(true);
  });

  it('test_funds_at_risk_classification_does_not_mark_pre_funding_or_settled_states', () => {
    expect(areFundsHeld('CREATED')).toBe(false);
    expect(areFundsHeld('PAYMENT_PENDING')).toBe(false);
    expect(areFundsHeld('PICKED_UP')).toBe(false);
    expect(areFundsHeld('REFUNDED')).toBe(false);
  });
});

describe('redeemability', () => {
  it('test_redeemability_permits_presentation_of_a_code_only_when_ready_or_partially_collected', () => {
    expect(isRedeemable('READY_FOR_PICKUP')).toBe(true);
    expect(isRedeemable('PARTIALLY_PICKED_UP')).toBe(true);
  });

  it('test_redeemability_refuses_every_other_state', () => {
    for (const status of TRANSACTION_STATUSES) {
      if (status === 'READY_FOR_PICKUP' || status === 'PARTIALLY_PICKED_UP') continue;
      expect(isRedeemable(status)).toBe(false);
    }
  });
});

describe('assertTransition throws rather than returning a flag', () => {
  it('test_asserttransition_throws_rather_than_returning_a_flag_succeeds_silently_on_a_legal_edge', () => {
    expect(() => assertTransition('CREATED', 'PAYMENT_PENDING', 'customer')).not.toThrow();
  });

  it('test_asserttransition_throws_rather_than_returning_a_flag_carries_the_from_and_to_on_the_error_for_the_audit_record', () => {
    try {
      assertTransition('CREATED', 'PICKED_UP', 'admin');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      expect((error as IllegalTransitionError).from).toBe('CREATED');
      expect((error as IllegalTransitionError).to).toBe('PICKED_UP');
    }
  });
});
