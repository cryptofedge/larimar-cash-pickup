import { describe, expect, it } from 'vitest';
import {
  computeLimitUsage,
  detectCodeBruteForce,
  evaluateRisk,
  levelForScore,
  requiresKyc,
  type RiskContext,
  type RiskPolicyConfig,
} from '@/lib/domain/risk';
import { fromDecimal } from '@/lib/domain/money';

const POLICY: RiskPolicyConfig = {
  countryCode: 'DO',
  version: 1,
  dailyLimitMinor: 100_000n, // $1,000.00
  monthlyLimitMinor: 500_000n, // $5,000.00
  perTransactionMinMinor: 1_000n, // $10.00
  perTransactionMaxMinor: 100_000n, // $1,000.00
  limitCurrency: 'USD',
  velocityWindowHours: 24,
  velocityMaxCount: 5,
  kycRequiredAboveMinor: 25_000n, // $250.00
  reviewScoreThreshold: 60,
  blockScoreThreshold: 85,
  highRiskCountries: ['KP', 'IR'],
};

const CLEAN: RiskContext = {
  amount: fromDecimal('349.62', 'USD'),
  dailyTotalMinor: 0n,
  monthlyTotalMinor: 0n,
  velocityCount: 0,
  accountAgeHours: 720,
  kycApproved: true,
  emailVerified: true,
  ipCountry: 'DO',
  cardCountry: 'DO',
  payoutCountry: 'DO',
  deviceAccountCount: 1,
  deviceIsNew: false,
  deviceBlocked: false,
  priorChargebackCount: 0,
  priorFailedPaymentCount: 0,
  locationRiskTier: 0,
  sanctionsHit: false,
  pepHit: false,
};

describe('score bucketing', () => {
  it.each([
    [0, 'LOW'],
    [29, 'LOW'],
    [30, 'MEDIUM'],
    [59, 'MEDIUM'],
    [60, 'HIGH'],
    [84, 'HIGH'],
    [85, 'CRITICAL'],
    [100, 'CRITICAL'],
  ] as const)('score %i is %s', (score, level) => {
    expect(levelForScore(score)).toBe(level);
  });
});

describe('a clean transaction', () => {
  const result = evaluateRisk(CLEAN, POLICY);

  it('test_a_clean_transaction_scores_low_and_is_allowed', () => {
    expect(result.score).toBe(0);
    expect(result.level).toBe('LOW');
    expect(result.decision).toBe('ALLOW');
  });

  it('test_a_clean_transaction_reports_no_triggered_signals', () => {
    expect(result.signals).toHaveLength(0);
  });

  it('test_a_clean_transaction_carries_no_block_code', () => {
    expect(result.blockCode).toBeUndefined();
  });
});

describe('hard limits produce honest refusals, not vague risk flags', () => {
  it('test_hard_limits_produce_honest_refusals_not_vague_risk_flags_blocks_below_the_transaction_minimum', () => {
    const result = evaluateRisk({ ...CLEAN, amount: fromDecimal('5.00', 'USD') }, POLICY);
    expect(result.decision).toBe('BLOCK');
    expect(result.blockCode).toBe('AMOUNT_BELOW_MINIMUM');
  });

  it('test_hard_limits_produce_honest_refusals_not_vague_risk_flags_blocks_above_the_transaction_maximum', () => {
    const result = evaluateRisk({ ...CLEAN, amount: fromDecimal('1500.00', 'USD') }, POLICY);
    expect(result.decision).toBe('BLOCK');
    expect(result.blockCode).toBe('AMOUNT_ABOVE_MAXIMUM');
  });

  it('test_hard_limits_produce_honest_refusals_not_vague_risk_flags_blocks_when_the_daily_limit_would_be_breached', () => {
    const result = evaluateRisk(
      { ...CLEAN, amount: fromDecimal('700.00', 'USD'), dailyTotalMinor: 40_000n },
      POLICY,
    );
    expect(result.decision).toBe('BLOCK');
    expect(result.blockCode).toBe('LIMIT_EXCEEDED_DAILY');
  });

  it('test_hard_limits_produce_honest_refusals_not_vague_risk_flags_allows_a_transaction_that_lands_exactly_on_the_daily_limit', () => {
    const result = evaluateRisk(
      { ...CLEAN, amount: fromDecimal('600.00', 'USD'), dailyTotalMinor: 40_000n },
      POLICY,
    );
    expect(result.blockCode).toBeUndefined();
  });

  it('test_hard_limits_produce_honest_refusals_not_vague_risk_flags_blocks_when_the_monthly_limit_would_be_breached', () => {
    const result = evaluateRisk(
      { ...CLEAN, amount: fromDecimal('200.00', 'USD'), monthlyTotalMinor: 490_000n },
      POLICY,
    );
    expect(result.decision).toBe('BLOCK');
    expect(result.blockCode).toBe('LIMIT_EXCEEDED_MONTHLY');
  });

  it('test_hard_limits_produce_honest_refusals_not_vague_risk_flags_blocks_on_velocity', () => {
    const result = evaluateRisk({ ...CLEAN, velocityCount: 5 }, POLICY);
    expect(result.decision).toBe('BLOCK');
    expect(result.blockCode).toBe('LIMIT_EXCEEDED_VELOCITY');
  });

  it('test_hard_limits_produce_honest_refusals_not_vague_risk_flags_blocks_on_a_sanctions_hit_above_everything_else', () => {
    const result = evaluateRisk({ ...CLEAN, sanctionsHit: true }, POLICY);
    expect(result.decision).toBe('BLOCK');
    expect(result.blockCode).toBe('SANCTIONS_MATCH');
    expect(result.level).toBe('CRITICAL');
  });
});

describe('behavioural signals', () => {
  it('test_behavioural_signals_flags_a_brand_new_account', () => {
    const result = evaluateRisk({ ...CLEAN, accountAgeHours: 0.5 }, POLICY);
    expect(result.signals.map((s) => s.ruleKey)).toContain('account.new');
    expect(result.score).toBeGreaterThan(0);
  });

  it('test_behavioural_signals_flags_a_device_shared_across_several_accounts_as_a_mule_indicator', () => {
    const result = evaluateRisk({ ...CLEAN, deviceAccountCount: 4 }, POLICY);
    expect(result.signals.map((s) => s.ruleKey)).toContain('device.shared');
  });

  it('test_behavioural_signals_flags_prior_chargebacks_heavily', () => {
    const result = evaluateRisk({ ...CLEAN, priorChargebackCount: 1 }, POLICY);
    const signal = result.signals.find((s) => s.ruleKey === 'history.chargebacks');
    expect(signal?.weight).toBe(40);
  });

  it('test_behavioural_signals_flags_repeated_failed_payments_as_card_testing', () => {
    const result = evaluateRisk({ ...CLEAN, priorFailedPaymentCount: 3 }, POLICY);
    expect(result.signals.map((s) => s.ruleKey)).toContain('history.failedPayments');
  });

  it('test_behavioural_signals_treats_an_ip_card_country_mismatch_as_a_soft_signal_since_travelers_legitimately_differ', () => {
    const result = evaluateRisk({ ...CLEAN, ipCountry: 'DO', cardCountry: 'US' }, POLICY);
    const signal = result.signals.find((s) => s.ruleKey === 'geo.ipCardMismatch');
    expect(signal?.weight).toBe(12);
    expect(result.decision).toBe('ALLOW');
  });

  it('test_behavioural_signals_does_not_flag_a_mismatch_when_either_country_is_unknown', () => {
    const result = evaluateRisk({ ...CLEAN, ipCountry: null, cardCountry: 'US' }, POLICY);
    expect(result.signals.map((s) => s.ruleKey)).not.toContain('geo.ipCardMismatch');
  });

  it('test_behavioural_signals_flags_an_elevated_risk_jurisdiction', () => {
    const result = evaluateRisk({ ...CLEAN, cardCountry: 'KP' }, POLICY);
    expect(result.signals.map((s) => s.ruleKey)).toContain('geo.highRiskCountry');
  });

  it('test_behavioural_signals_flags_a_high_risk_pickup_location_tier', () => {
    const result = evaluateRisk({ ...CLEAN, locationRiskTier: 3 }, POLICY);
    expect(result.signals.map((s) => s.ruleKey)).toContain('location.riskTier');
  });

  it('test_behavioural_signals_flags_high_daily_limit_utilisation_even_when_within_limits', () => {
    const result = evaluateRisk(
      { ...CLEAN, amount: fromDecimal('850.00', 'USD') },
      POLICY,
    );
    expect(result.signals.map((s) => s.ruleKey)).toContain('limits.dailyUtilisation');
  });
});

describe('escalation to compliance review', () => {
  it('test_escalation_to_compliance_review_routes_a_combination_of_moderate_signals_to_review', () => {
    const result = evaluateRisk(
      {
        ...CLEAN,
        accountAgeHours: 0.5, // 20
        deviceAccountCount: 4, // 30
        deviceIsNew: true, // 8
        emailVerified: false, // 10
        priorFailedPaymentCount: 3, // 15
      },
      POLICY,
    );
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.decision).toBe('REVIEW');
    expect(result.level).toBe('HIGH');
  });

  it('test_escalation_to_compliance_review_blocks_once_the_score_passes_the_block_threshold', () => {
    const result = evaluateRisk(
      {
        ...CLEAN,
        accountAgeHours: 0.5,
        deviceAccountCount: 5,
        deviceIsNew: true,
        emailVerified: false,
        priorChargebackCount: 2,
        priorFailedPaymentCount: 4,
      },
      POLICY,
    );
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.decision).toBe('BLOCK');
    expect(result.blockCode).toBe('RISK_BLOCKED');
  });

  it('test_escalation_to_compliance_review_caps_the_score_at_100', () => {
    const result = evaluateRisk(
      { ...CLEAN, sanctionsHit: true, deviceBlocked: true, priorChargebackCount: 9 },
      POLICY,
    );
    expect(result.score).toBe(100);
  });
});

describe('KYC gating', () => {
  it('test_kyc_gating_requires_verification_above_the_configured_amount', () => {
    expect(requiresKyc(fromDecimal('250.00', 'USD'), POLICY)).toBe(true);
    expect(requiresKyc(fromDecimal('249.99', 'USD'), POLICY)).toBe(false);
  });

  it('test_kyc_gating_reports_kycrequired_on_the_assessment_for_an_unverified_user', () => {
    const result = evaluateRisk({ ...CLEAN, kycApproved: false }, POLICY);
    expect(result.kycRequired).toBe(true);
    expect(result.signals.map((s) => s.ruleKey)).toContain('kyc.missingForAmount');
  });

  it('test_kyc_gating_does_not_require_verification_below_the_threshold', () => {
    const result = evaluateRisk(
      { ...CLEAN, kycApproved: false, amount: fromDecimal('50.00', 'USD') },
      POLICY,
    );
    expect(result.kycRequired).toBe(false);
  });
});

describe('limit usage reporting', () => {
  it('test_limit_usage_reporting_computes_remaining_headroom', () => {
    const usage = computeLimitUsage(30_000n, 120_000n, POLICY);
    expect(usage.dailyRemainingMinor).toBe(70_000n);
    expect(usage.monthlyRemainingMinor).toBe(380_000n);
    expect(usage.currency).toBe('USD');
  });

  it('test_limit_usage_reporting_never_reports_negative_headroom', () => {
    const usage = computeLimitUsage(150_000n, 600_000n, POLICY);
    expect(usage.dailyRemainingMinor).toBe(0n);
    expect(usage.monthlyRemainingMinor).toBe(0n);
  });
});

describe('pickup-code brute force detection', () => {
  it('test_pickup_code_brute_force_detection_ignores_normal_activity', () => {
    expect(detectCodeBruteForce({ failedAttemptsLastHour: 2, distinctCodesAttempted: 1 }).detected).toBe(false);
  });

  it('test_pickup_code_brute_force_detection_catches_attempts_spread_across_many_codes_to_evade_per_code_limits', () => {
    const result = detectCodeBruteForce({ failedAttemptsLastHour: 6, distinctCodesAttempted: 6 });
    expect(result.detected).toBe(true);
    expect(result.severity).toBe('MEDIUM');
  });

  it('test_pickup_code_brute_force_detection_escalates_on_volume', () => {
    expect(detectCodeBruteForce({ failedAttemptsLastHour: 12, distinctCodesAttempted: 2 }).severity).toBe('HIGH');
    expect(detectCodeBruteForce({ failedAttemptsLastHour: 40, distinctCodesAttempted: 20 }).severity).toBe('CRITICAL');
  });
});
