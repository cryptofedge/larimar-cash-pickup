/**
 * Risk-based collection delay.
 *
 * The strongest available control against stolen-card cash-out: most such fraud
 * is time-sensitive, and a delay gives the issuer a window to decline before the
 * pesos are irrecoverable.
 *
 * It is applied only above a risk threshold, because a blanket delay would break
 * the product's "arrange cash before you need it" promise for every honest
 * customer in order to slow down a small minority.
 */

import { describe, expect, it } from 'vitest';
import {
  checkCodeUsable,
  collectableFromFor,
  shouldBurnAttempt,
  type PickupCodeState,
} from '@/lib/domain/pickup-code';

const ISSUED_AT = new Date('2026-06-01T12:00:00Z');

function activeCode(overrides: Partial<PickupCodeState> = {}): PickupCodeState {
  return {
    status: 'ACTIVE',
    attemptCount: 0,
    maxAttempts: 5,
    expiresAt: new Date('2026-07-01T12:00:00Z'),
    collectableFrom: null,
    ...overrides,
  };
}

describe('collectable from calculation', () => {
  it('test_collection_delay_returns_null_when_the_policy_delay_is_zero', () => {
    // Arrange
    const input = { issuedAt: ISSUED_AT, riskScore: 90, delayMinutes: 0, riskThreshold: 30 };

    // Act
    const result = collectableFromFor(input);

    // Assert — a disabled policy must not impose a hold on anyone.
    expect(result).toBeNull();
  });

  it('test_collection_delay_returns_null_below_the_risk_threshold', () => {
    // Arrange
    const input = { issuedAt: ISSUED_AT, riskScore: 29, delayMinutes: 30, riskThreshold: 30 };

    // Act
    const result = collectableFromFor(input);

    // Assert — the honest-customer path stays instant.
    expect(result).toBeNull();
  });

  it('test_collection_delay_applies_exactly_at_the_risk_threshold', () => {
    // Arrange
    const input = { issuedAt: ISSUED_AT, riskScore: 30, delayMinutes: 30, riskThreshold: 30 };

    // Act
    const result = collectableFromFor(input);

    // Assert
    expect(result).toEqual(new Date('2026-06-01T12:30:00Z'));
  });

  it('test_collection_delay_applies_above_the_risk_threshold', () => {
    // Arrange
    const input = { issuedAt: ISSUED_AT, riskScore: 75, delayMinutes: 120, riskThreshold: 30 };

    // Act
    const result = collectableFromFor(input);

    // Assert
    expect(result).toEqual(new Date('2026-06-01T14:00:00Z'));
  });
});

describe('code usability during the hold', () => {
  it('test_collection_delay_refuses_a_code_before_the_hold_lifts', () => {
    // Arrange
    const state = activeCode({ collectableFrom: new Date('2026-06-01T12:30:00Z') });

    // Act
    const result = checkCodeUsable(state, new Date('2026-06-01T12:29:59Z'));

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PICKUP_CODE_NOT_YET_COLLECTABLE');
      expect(result.collectableFrom).toEqual(new Date('2026-06-01T12:30:00Z'));
    }
  });

  it('test_collection_delay_allows_a_code_exactly_when_the_hold_lifts', () => {
    // Arrange
    const state = activeCode({ collectableFrom: new Date('2026-06-01T12:30:00Z') });

    // Act
    const result = checkCodeUsable(state, new Date('2026-06-01T12:30:00Z'));

    // Assert
    expect(result).toEqual({ ok: true });
  });

  it('test_collection_delay_allows_a_code_with_no_hold_set', () => {
    // Arrange
    const state = activeCode({ collectableFrom: null });

    // Act
    const result = checkCodeUsable(state, ISSUED_AT);

    // Assert
    expect(result).toEqual({ ok: true });
  });

  it('test_collection_delay_reports_expiry_ahead_of_the_hold', () => {
    // Arrange — a code both expired and notionally still held.
    const state = activeCode({
      collectableFrom: new Date('2026-08-01T12:00:00Z'),
      expiresAt: new Date('2026-07-01T12:00:00Z'),
    });

    // Act
    const result = checkCodeUsable(state, new Date('2026-07-02T00:00:00Z'));

    // Assert — telling the holder to come back later for cash they can no longer
    // collect would be actively misleading.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_EXPIRED');
  });

  it('test_collection_delay_reports_lockout_ahead_of_the_hold', () => {
    // Arrange
    const state = activeCode({
      status: 'LOCKED',
      collectableFrom: new Date('2026-06-01T12:30:00Z'),
    });

    // Act
    const result = checkCodeUsable(state, new Date('2026-06-01T12:00:00Z'));

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_LOCKED');
  });
});

describe('attempt accounting during the hold', () => {
  it('test_collection_delay_does_not_consume_an_attempt_when_presented_early', () => {
    // Arrange / Act / Assert
    //
    // An early arrival is an impatient customer, not an attacker. Burning an
    // attempt would let them lock themselves out of their own cash.
    expect(shouldBurnAttempt('PICKUP_CODE_NOT_YET_COLLECTABLE')).toBe(false);
  });

  it.each([
    'PICKUP_CODE_INVALID',
    'PICKUP_CODE_EXPIRED',
    'PICKUP_CODE_LOCKED',
    'PICKUP_CODE_ALREADY_REDEEMED',
    'PICKUP_CODE_ATTEMPTS_EXCEEDED',
  ] as const)('test_collection_delay_still_consumes_an_attempt_for [%s]', (code) => {
    // Arrange / Act / Assert — every other failure remains attributable.
    expect(shouldBurnAttempt(code)).toBe(true);
  });
});
