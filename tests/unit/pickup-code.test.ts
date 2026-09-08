import { describe, expect, it } from 'vitest';
import {
  CODE_ENTROPY_BITS,
  CODE_SYMBOL_COUNT,
  bruteForceKeyspace,
  buildQrPayload,
  checkCodeUsable,
  expiryFrom,
  generatePickupCredential,
  hashCode,
  isWellFormedCode,
  maskCode,
  normalizeCode,
  parseQrPayload,
  safeCompareHash,
  shouldLockAfterFailure,
  type PickupCodeState,
} from '@/lib/domain/pickup-code';
import { DomainError } from '@/lib/domain/errors';

const PEPPER = 'test-pepper-value-at-least-16-chars';

describe('credential generation', () => {
  it('test_credential_generation_produces_the_dr_xxxx_xxxx_shape', () => {
    const cred = generatePickupCredential('DR', PEPPER);
    expect(cred.code).toMatch(/^DR-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(cred.prefix).toBe('DR');
  });

  it('test_credential_generation_carries_40_bits_of_entropy_enough_for_a_cash_bearer_instrument', () => {
    expect(CODE_SYMBOL_COUNT).toBe(8);
    expect(CODE_ENTROPY_BITS).toBe(40);
    expect(bruteForceKeyspace()).toBe(1_099_511_627_776n); // 32^8
  });

  it('test_credential_generation_accepts_the_documented_example_format', () => {
    expect(isWellFormedCode('DR-4829-7316')).toBe(true);
  });

  it('test_credential_generation_never_emits_the_ambiguous_characters_i_l_o_or_u', () => {
    for (let i = 0; i < 300; i += 1) {
      const { code } = generatePickupCredential('DR', PEPPER);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('test_credential_generation_generates_a_128_bit_hex_secret_as_the_second_factor', () => {
    const cred = generatePickupCredential('DR', PEPPER);
    expect(cred.secret).toMatch(/^[0-9a-f]{32}$/);
  });

  it('test_credential_generation_does_not_repeat_across_many_draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      seen.add(generatePickupCredential('DR', PEPPER).code);
    }
    expect(seen.size).toBe(2000);
  });

  it('test_credential_generation_distributes_symbols_roughly_uniformly_no_modulo_bias', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i += 1) {
      for (const ch of generatePickupCredential('DR', PEPPER).code.replace(/[-]|^DR/g, '')) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const expected = total / 32;
    for (const count of counts.values()) {
      // Generous band: this catches structural bias, not statistical noise.
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(expected * 1.3);
    }
  });

  it('test_credential_generation_rejects_a_malformed_prefix', () => {
    expect(() => generatePickupCredential('D', PEPPER)).toThrow(DomainError);
    expect(() => generatePickupCredential('D1', PEPPER)).toThrow(DomainError);
  });
});

describe('normalisation — what a human might actually type', () => {
  it.each([
    'DR-4829-7316',
    'dr-4829-7316',
    'DR48297316',
    'dr 4829 7316',
    '  DR-4829-7316  ',
    'DR_4829_7316',
  ])('normalises "%s"', (input) => {
    expect(normalizeCode(input)).toBe('DR-4829-7316');
  });

  it('test_normalisation_what_a_human_might_actually_type_maps_confusable_characters_to_their_canonical_symbol', () => {
    expect(normalizeCode('DR-48I9-73O6')).toBe('DR-4819-7306');
    expect(normalizeCode('DR-48L9-7316')).toBe('DR-4819-7316');
    expect(normalizeCode('DR-482U-7316')).toBe('DR-482V-7316');
  });

  it('test_normalisation_what_a_human_might_actually_type_rejects_wrong_lengths_and_bad_shapes', () => {
    expect(() => normalizeCode('DR-482-7316')).toThrow(DomainError);
    expect(() => normalizeCode('DR-48299-7316')).toThrow(DomainError);
    expect(() => normalizeCode('4829-7316')).toThrow(DomainError);
    expect(() => normalizeCode('')).toThrow(DomainError);
  });

  it('test_normalisation_what_a_human_might_actually_type_reports_well_formedness_without_throwing', () => {
    expect(isWellFormedCode('DR-4829-7316')).toBe(true);
    expect(isWellFormedCode('nonsense')).toBe(false);
  });
});

describe('hashing', () => {
  it('test_hashing_is_stable_across_equivalent_inputs', () => {
    expect(hashCode('DR-4829-7316', PEPPER)).toBe(hashCode('dr48297316', PEPPER));
  });

  it('test_hashing_changes_with_the_pepper_a_database_dump_alone_cannot_redeem', () => {
    expect(hashCode('DR-4829-7316', PEPPER)).not.toBe(
      hashCode('DR-4829-7316', 'a-completely-different-pepper'),
    );
  });

  it('test_hashing_produces_a_sha256_hex_digest', () => {
    expect(hashCode('DR-4829-7316', PEPPER)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('test_hashing_refuses_a_weak_or_missing_pepper', () => {
    expect(() => hashCode('DR-4829-7316', '')).toThrow(/PICKUP_CODE_PEPPER/);
    expect(() => hashCode('DR-4829-7316', 'short')).toThrow(/PICKUP_CODE_PEPPER/);
  });

  it('test_hashing_compares_in_constant_time', () => {
    const a = hashCode('DR-4829-7316', PEPPER);
    expect(safeCompareHash(a, a)).toBe(true);
    expect(safeCompareHash(a, hashCode('DR-1111-2222', PEPPER))).toBe(false);
    expect(safeCompareHash(a, 'short')).toBe(false);
  });
});

describe('QR payload', () => {
  it('test_qr_payload_round_trips', () => {
    const cred = generatePickupCredential('DR', PEPPER);
    const parsed = parseQrPayload(buildQrPayload(cred.code, cred.secret));
    expect(parsed.code).toBe(cred.code);
    expect(parsed.secret).toBe(cred.secret);
  });

  it('test_qr_payload_carries_no_personal_information_only_the_credential', () => {
    const payload = buildQrPayload('DR-4829-7316', 'a'.repeat(32));
    expect(payload).toBe(`LARIMAR:1:DR-4829-7316:${'a'.repeat(32)}`);
    expect(payload.split(':')).toHaveLength(4);
  });

  it('test_qr_payload_rejects_tampered_or_foreign_payloads', () => {
    expect(() => parseQrPayload('nonsense')).toThrow(DomainError);
    expect(() => parseQrPayload('LARIMAR:2:DR-4829-7316:' + 'a'.repeat(32))).toThrow(DomainError);
    expect(() => parseQrPayload('LARIMAR:1:DR-4829-7316:tooshort')).toThrow(DomainError);
  });
});

describe('masking for logs and audit records', () => {
  it('test_masking_for_logs_and_audit_records_hides_the_first_group', () => {
    expect(maskCode('DR-4829-7316')).toBe('DR-****-7316');
  });

  it('test_masking_for_logs_and_audit_records_degrades_safely_on_garbage_rather_than_leaking_it', () => {
    expect(maskCode('not-a-code')).toBe('****');
  });
});

describe('redemption eligibility', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const base: PickupCodeState = {
    status: 'ACTIVE',
    attemptCount: 0,
    maxAttempts: 5,
    expiresAt: new Date('2026-07-01T12:00:00Z'),
  };

  it('test_redemption_eligibility_allows_a_fresh_active_code', () => {
    expect(checkCodeUsable(base, now)).toEqual({ ok: true });
  });

  it('test_redemption_eligibility_refuses_an_already_redeemed_code', () => {
    const result = checkCodeUsable({ ...base, status: 'REDEEMED' }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_ALREADY_REDEEMED');
  });

  it('test_redemption_eligibility_refuses_a_cancelled_code', () => {
    const result = checkCodeUsable({ ...base, status: 'CANCELLED' }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_INVALID');
  });

  it('test_redemption_eligibility_refuses_an_expired_code_by_timestamp_even_when_still_marked_active', () => {
    const result = checkCodeUsable(base, new Date('2026-08-01T00:00:00Z'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_EXPIRED');
  });

  it('test_redemption_eligibility_expires_exactly_at_the_boundary', () => {
    expect(checkCodeUsable(base, new Date(base.expiresAt.getTime() - 1)).ok).toBe(true);
    expect(checkCodeUsable(base, new Date(base.expiresAt.getTime())).ok).toBe(false);
  });

  it('test_redemption_eligibility_refuses_a_locked_code', () => {
    const result = checkCodeUsable({ ...base, status: 'LOCKED' }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_LOCKED');
  });

  it('test_redemption_eligibility_refuses_once_attempts_are_exhausted', () => {
    const result = checkCodeUsable({ ...base, attemptCount: 5 }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_ATTEMPTS_EXCEEDED');
  });

  it('test_redemption_eligibility_reports_expiry_ahead_of_lockout_so_the_reason_is_honest', () => {
    const result = checkCodeUsable(
      { ...base, status: 'LOCKED' },
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_EXPIRED');
  });

  it('test_redemption_eligibility_signals_when_the_next_failure_should_lock_the_code', () => {
    expect(shouldLockAfterFailure({ ...base, attemptCount: 3 })).toBe(false);
    expect(shouldLockAfterFailure({ ...base, attemptCount: 4 })).toBe(true);
  });
});

describe('expiry calculation', () => {
  it('test_expiry_calculation_adds_whole_days', () => {
    const issued = new Date('2026-06-01T12:00:00Z');
    expect(expiryFrom(issued, 30).toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });
});
