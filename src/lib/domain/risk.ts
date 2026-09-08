/**
 * Risk and compliance rule engine.
 *
 * Cash-out is a fraud magnet: a stolen card funds an irreversible disbursement to
 * a stranger who then walks away. The controls here are deliberately layered, and
 * each one is a small pure function so it can be tested in isolation and reasoned
 * about by a compliance analyst who does not read TypeScript.
 *
 * Everything is CONFIGURABLE. The thresholds shipped in the seed are engineering
 * defaults for a demo. They are NOT Dominican legal limits, and this file must
 * never be read as legal guidance.
 *
 * Pure module.
 */

import type { Money } from './money';
import { compare, fromMinor } from './money';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskDecision = 'ALLOW' | 'REVIEW' | 'BLOCK';

export interface RiskPolicyConfig {
  readonly countryCode: string;
  readonly version: number;
  readonly dailyLimitMinor: bigint;
  readonly monthlyLimitMinor: bigint;
  readonly perTransactionMinMinor: bigint;
  readonly perTransactionMaxMinor: bigint;
  readonly limitCurrency: string;
  readonly velocityWindowHours: number;
  readonly velocityMaxCount: number;
  readonly kycRequiredAboveMinor: bigint;
  readonly reviewScoreThreshold: number;
  readonly blockScoreThreshold: number;
  readonly highRiskCountries: readonly string[];
}

export interface RiskContext {
  /** Funding-currency value of this transaction, in the policy's limit currency. */
  readonly amount: Money;
  /** Already transacted in the rolling day and calendar month, same currency. */
  readonly dailyTotalMinor: bigint;
  readonly monthlyTotalMinor: bigint;
  /** Completed or in-flight transactions inside the velocity window. */
  readonly velocityCount: number;

  readonly accountAgeHours: number;
  readonly kycApproved: boolean;
  readonly emailVerified: boolean;

  /** ISO-3166 alpha-2. Any may be unknown. */
  readonly ipCountry: string | null;
  readonly cardCountry: string | null;
  readonly payoutCountry: string;

  /** Distinct accounts seen on this device fingerprint. */
  readonly deviceAccountCount: number;
  readonly deviceIsNew: boolean;
  readonly deviceBlocked: boolean;

  readonly priorChargebackCount: number;
  readonly priorFailedPaymentCount: number;
  /** 0 = lowest risk. From the pickup location record. */
  readonly locationRiskTier: number;

  readonly sanctionsHit: boolean;
  readonly pepHit: boolean;
}

export interface RiskSignal {
  readonly ruleKey: string;
  readonly triggered: boolean;
  /** Points contributed to the 0-100 score. */
  readonly weight: number;
  readonly level: RiskLevel;
  readonly detail: string;
}

export interface RiskAssessment {
  readonly score: number;
  readonly level: RiskLevel;
  readonly decision: RiskDecision;
  readonly signals: readonly RiskSignal[];
  /** Present when the decision is BLOCK. A stable code, safe to show a customer. */
  readonly blockCode?:
    | 'LIMIT_EXCEEDED_DAILY'
    | 'LIMIT_EXCEEDED_MONTHLY'
    | 'LIMIT_EXCEEDED_VELOCITY'
    | 'AMOUNT_BELOW_MINIMUM'
    | 'AMOUNT_ABOVE_MAXIMUM'
    | 'SANCTIONS_MATCH'
    | 'RISK_BLOCKED';
  readonly kycRequired: boolean;
}

const signal = (
  ruleKey: string,
  triggered: boolean,
  weight: number,
  level: RiskLevel,
  detail: string,
): RiskSignal => Object.freeze({ ruleKey, triggered, weight: triggered ? weight : 0, level, detail });

export function levelForScore(score: number): RiskLevel {
  if (score >= 85) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

/**
 * Evaluate every rule and aggregate.
 *
 * Hard limits (amount bounds, daily/monthly caps, velocity, sanctions) are
 * absolute refusals, evaluated separately from the score. A transaction can be
 * refused with a LOW behavioural score simply because it exceeds a cap — the two
 * concepts are kept distinct so a customer gets an honest reason rather than a
 * vague "flagged as risky".
 */
export function evaluateRisk(context: RiskContext, policy: RiskPolicyConfig): RiskAssessment {
  const amountMinor = context.amount.amount;
  const signals: RiskSignal[] = [];

  // --- Hard limits -------------------------------------------------------
  let blockCode: RiskAssessment['blockCode'];

  if (context.sanctionsHit) {
    blockCode = 'SANCTIONS_MATCH';
  } else if (amountMinor < policy.perTransactionMinMinor) {
    blockCode = 'AMOUNT_BELOW_MINIMUM';
  } else if (amountMinor > policy.perTransactionMaxMinor) {
    blockCode = 'AMOUNT_ABOVE_MAXIMUM';
  } else if (context.dailyTotalMinor + amountMinor > policy.dailyLimitMinor) {
    blockCode = 'LIMIT_EXCEEDED_DAILY';
  } else if (context.monthlyTotalMinor + amountMinor > policy.monthlyLimitMinor) {
    blockCode = 'LIMIT_EXCEEDED_MONTHLY';
  } else if (context.velocityCount >= policy.velocityMaxCount) {
    blockCode = 'LIMIT_EXCEEDED_VELOCITY';
  }

  // --- Scored signals ----------------------------------------------------

  signals.push(
    signal(
      'sanctions.hit',
      context.sanctionsHit,
      100,
      'CRITICAL',
      'Subject matched a sanctions list entry',
    ),
  );

  signals.push(
    signal('sanctions.pep', context.pepHit, 35, 'HIGH', 'Subject matched a politically exposed person list'),
  );

  signals.push(
    signal('device.blocked', context.deviceBlocked, 100, 'CRITICAL', 'Device is on the block list'),
  );

  // A large share of the daily cap in one go is worth a look even when legal.
  const dailyUtilisation =
    policy.dailyLimitMinor > 0n
      ? Number(((context.dailyTotalMinor + amountMinor) * 100n) / policy.dailyLimitMinor)
      : 0;
  signals.push(
    signal(
      'limits.dailyUtilisation',
      dailyUtilisation >= 80,
      15,
      'MEDIUM',
      `Transaction consumes ${dailyUtilisation}% of the daily limit`,
    ),
  );

  signals.push(
    signal(
      'velocity.approaching',
      context.velocityCount >= Math.max(1, policy.velocityMaxCount - 1),
      20,
      'MEDIUM',
      `${context.velocityCount} transactions in the last ${policy.velocityWindowHours}h`,
    ),
  );

  // A brand-new account moving money immediately is the classic stolen-card pattern.
  signals.push(
    signal('account.new', context.accountAgeHours < 1, 20, 'MEDIUM', 'Account created less than an hour ago'),
  );
  signals.push(
    signal('account.young', context.accountAgeHours >= 1 && context.accountAgeHours < 24, 10, 'LOW', 'Account created within 24 hours'),
  );
  signals.push(
    signal('account.emailUnverified', !context.emailVerified, 10, 'LOW', 'Email address is not verified'),
  );

  signals.push(
    signal(
      'kyc.missingForAmount',
      !context.kycApproved && amountMinor >= policy.kycRequiredAboveMinor,
      25,
      'HIGH',
      'Amount requires identity verification that has not been completed',
    ),
  );

  // One device, many accounts, is the signature of a mule ring.
  signals.push(
    signal('device.shared', context.deviceAccountCount > 2, 30, 'HIGH', `Device linked to ${context.deviceAccountCount} accounts`),
  );
  signals.push(signal('device.new', context.deviceIsNew, 8, 'LOW', 'First transaction from this device'));

  // Geography. The traveler story means IP and card country legitimately differ
  // from the payout country, so this is weighted as a soft signal, not a block.
  const ipMismatch =
    context.ipCountry !== null &&
    context.cardCountry !== null &&
    context.ipCountry !== context.cardCountry;
  signals.push(
    signal('geo.ipCardMismatch', ipMismatch, 12, 'MEDIUM', `IP country ${context.ipCountry} differs from card country ${context.cardCountry}`),
  );

  const highRiskIp =
    context.ipCountry !== null && policy.highRiskCountries.includes(context.ipCountry);
  const highRiskCard =
    context.cardCountry !== null && policy.highRiskCountries.includes(context.cardCountry);
  signals.push(
    signal('geo.highRiskCountry', highRiskIp || highRiskCard, 30, 'HIGH', 'IP or card originates in an elevated-risk jurisdiction'),
  );

  signals.push(
    signal('history.chargebacks', context.priorChargebackCount > 0, 40, 'HIGH', `${context.priorChargebackCount} prior chargeback(s) on this account`),
  );
  signals.push(
    signal('history.failedPayments', context.priorFailedPaymentCount >= 3, 15, 'MEDIUM', `${context.priorFailedPaymentCount} recent failed payment attempts (possible card testing)`),
  );

  signals.push(
    signal('location.riskTier', context.locationRiskTier >= 2, 10, 'MEDIUM', `Pickup location is risk tier ${context.locationRiskTier}`),
  );

  // --- Aggregate ---------------------------------------------------------

  const rawScore = signals.reduce((total, s) => total + s.weight, 0);
  const score = Math.min(100, rawScore);
  const level = levelForScore(score);

  if (!blockCode && score >= policy.blockScoreThreshold) {
    blockCode = 'RISK_BLOCKED';
  }

  const decision: RiskDecision = blockCode
    ? 'BLOCK'
    : score >= policy.reviewScoreThreshold
      ? 'REVIEW'
      : 'ALLOW';

  const kycRequired = !context.kycApproved && amountMinor >= policy.kycRequiredAboveMinor;

  return Object.freeze({
    score,
    level,
    decision,
    signals: Object.freeze(signals.filter((s) => s.triggered)),
    ...(blockCode ? { blockCode } : {}),
    kycRequired,
  });
}

/** Does this amount require verified identity under the policy? */
export function requiresKyc(amount: Money, policy: RiskPolicyConfig): boolean {
  return compare(amount, fromMinor(policy.kycRequiredAboveMinor, policy.limitCurrency)) >= 0;
}

export interface LimitUsage {
  readonly dailyUsedMinor: bigint;
  readonly dailyLimitMinor: bigint;
  readonly dailyRemainingMinor: bigint;
  readonly monthlyUsedMinor: bigint;
  readonly monthlyLimitMinor: bigint;
  readonly monthlyRemainingMinor: bigint;
  readonly currency: string;
}

export function computeLimitUsage(
  dailyTotalMinor: bigint,
  monthlyTotalMinor: bigint,
  policy: RiskPolicyConfig,
): LimitUsage {
  const clampZero = (v: bigint): bigint => (v < 0n ? 0n : v);
  return {
    dailyUsedMinor: dailyTotalMinor,
    dailyLimitMinor: policy.dailyLimitMinor,
    dailyRemainingMinor: clampZero(policy.dailyLimitMinor - dailyTotalMinor),
    monthlyUsedMinor: monthlyTotalMinor,
    monthlyLimitMinor: policy.monthlyLimitMinor,
    monthlyRemainingMinor: clampZero(policy.monthlyLimitMinor - monthlyTotalMinor),
    currency: policy.limitCurrency,
  };
}

/**
 * Attempts against pickup codes, evaluated across a whole location or agent
 * rather than a single code. An attacker guessing codes spreads attempts across
 * many codes precisely to stay under any per-code limit; this catches that.
 */
export function detectCodeBruteForce(input: {
  failedAttemptsLastHour: number;
  distinctCodesAttempted: number;
  threshold?: number;
}): { detected: boolean; severity: RiskLevel; detail: string } {
  const threshold = input.threshold ?? 10;

  if (input.failedAttemptsLastHour >= threshold * 3) {
    return {
      detected: true,
      severity: 'CRITICAL',
      detail: `${input.failedAttemptsLastHour} failed pickup-code attempts in one hour across ${input.distinctCodesAttempted} codes`,
    };
  }
  if (input.failedAttemptsLastHour >= threshold) {
    return {
      detected: true,
      severity: 'HIGH',
      detail: `${input.failedAttemptsLastHour} failed pickup-code attempts in one hour`,
    };
  }
  if (input.distinctCodesAttempted >= 5 && input.failedAttemptsLastHour >= 5) {
    return {
      detected: true,
      severity: 'MEDIUM',
      detail: `Failed attempts spread across ${input.distinctCodesAttempted} distinct codes`,
    };
  }
  return { detected: false, severity: 'LOW', detail: 'No brute-force pattern detected' };
}
