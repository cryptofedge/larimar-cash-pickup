/**
 * Identity verification (KYC) and screening ports.
 *
 * These mocks perform NO real verification and NO real screening. A name that
 * "passes" here has been checked against nothing. Production requires a vendor
 * with document authentication, biometric liveness, and genuine sanctions/PEP
 * coverage. See docs/LEGAL_AND_COMPLIANCE.md.
 */

import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { verifySignature } from '../auth/crypto';

export type KycDecision = 'APPROVED' | 'REJECTED' | 'PENDING' | 'MANUAL_REVIEW';

export interface KycSubmission {
  readonly userId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string;
  readonly documentType: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE' | 'RESIDENCE_PERMIT';
  readonly documentNumber: string;
  readonly documentCountry: string;
  readonly residenceCountry: string;
}

export interface KycResult {
  readonly providerRef: string;
  readonly decision: KycDecision;
  readonly level: 'NONE' | 'BASIC' | 'ENHANCED';
  /** Last 4 only. The full document number is never persisted. */
  readonly documentLast4: string;
  readonly rejectionReason?: string;
  readonly checks: Readonly<Record<string, boolean>>;
}

export interface KycProvider {
  readonly name: string;
  submit(submission: KycSubmission): Promise<KycResult>;
  getResult(providerRef: string): Promise<KycResult | null>;
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): { valid: boolean; reason?: string };
}

/**
 * Demo trigger values, so every branch is reachable from the UI without a vendor.
 * A surname of REJECT fails; REVIEW goes to manual; anything else passes.
 */
export const KYC_DEMO_TRIGGERS = {
  REJECT_SURNAME: 'REJECT',
  REVIEW_SURNAME: 'REVIEW',
  PENDING_SURNAME: 'PENDING',
} as const;

const results = new Map<string, KycResult>();

export class MockKycProvider implements KycProvider {
  readonly name = 'mock';

  async submit(submission: KycSubmission): Promise<KycResult> {
    const providerRef = `kyc_mock_${randomUUID().slice(0, 18)}`;
    const surname = submission.lastName.trim().toUpperCase();
    const last4 = submission.documentNumber.slice(-4).padStart(4, '*');

    // Everything below is simulated. No document is authenticated.
    const documentAuthentic = surname !== KYC_DEMO_TRIGGERS.REJECT_SURNAME;
    const ageVerified = isAtLeast18(submission.dateOfBirth);

    let decision: KycDecision = 'APPROVED';
    let rejectionReason: string | undefined;

    if (!ageVerified) {
      decision = 'REJECTED';
      rejectionReason = 'Applicant appears to be under 18';
    } else if (surname === KYC_DEMO_TRIGGERS.REJECT_SURNAME) {
      decision = 'REJECTED';
      rejectionReason = 'Document could not be authenticated (demo trigger)';
    } else if (surname === KYC_DEMO_TRIGGERS.REVIEW_SURNAME) {
      decision = 'MANUAL_REVIEW';
    } else if (surname === KYC_DEMO_TRIGGERS.PENDING_SURNAME) {
      decision = 'PENDING';
    }

    const result: KycResult = {
      providerRef,
      decision,
      level: decision === 'APPROVED' ? 'BASIC' : 'NONE',
      documentLast4: last4,
      ...(rejectionReason ? { rejectionReason } : {}),
      checks: {
        documentAuthentic,
        ageVerified,
        // Named honestly: these did not actually run.
        faceMatchSimulated: decision === 'APPROVED',
        addressVerifiedSimulated: decision === 'APPROVED',
      },
    };

    results.set(providerRef, result);
    return result;
  }

  async getResult(providerRef: string): Promise<KycResult | null> {
    return results.get(providerRef) ?? null;
  }

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
  ): { valid: boolean; reason?: string } {
    const signature = headers['x-larimar-signature'];
    const timestamp = headers['x-larimar-timestamp'];
    if (!signature || !timestamp) return { valid: false, reason: 'Missing signature or timestamp' };
    return verifySignature({
      payload: rawBody,
      timestamp,
      signature,
      secret: env.KYC_WEBHOOK_SECRET,
      toleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS,
    });
  }

  static reset(): void {
    results.clear();
  }
}

function isAtLeast18(dateOfBirth: string): boolean {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;
  const eighteen = new Date(dob.getFullYear() + 18, dob.getMonth(), dob.getDate());
  return eighteen <= new Date();
}

// ---------------------------------------------------------------------------
// Sanctions and PEP screening
// ---------------------------------------------------------------------------

export interface SanctionsCheckInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth?: string;
  readonly country?: string;
}

export interface SanctionsCheckResult {
  readonly sanctionsHit: boolean;
  readonly pepHit: boolean;
  readonly matchedLists: readonly string[];
  readonly checkedAt: Date;
  readonly provider: string;
}

export interface SanctionsProvider {
  readonly name: string;
  screen(input: SanctionsCheckInput): Promise<SanctionsCheckResult>;
}

/**
 * A fixture list of obviously fictional names. This is a WIRING TEST, not
 * screening — it matches against four strings, while a real programme screens
 * against OFAC SDN, UN consolidated, EU, UK HMT, and local DR lists with fuzzy
 * matching, aliases, and transliteration.
 */
const DEMO_SANCTIONS_LIST = ['SANCTIONED', 'BLOCKEDPERSON'];
const DEMO_PEP_LIST = ['POLITICIAN', 'MINISTER'];

export class MockSanctionsProvider implements SanctionsProvider {
  readonly name = 'mock';

  async screen(input: SanctionsCheckInput): Promise<SanctionsCheckResult> {
    const surname = input.lastName.trim().toUpperCase();
    const sanctionsHit = DEMO_SANCTIONS_LIST.includes(surname);
    const pepHit = DEMO_PEP_LIST.includes(surname);

    const matchedLists: string[] = [];
    if (sanctionsHit) matchedLists.push('DEMO_SANCTIONS_FIXTURE');
    if (pepHit) matchedLists.push('DEMO_PEP_FIXTURE');

    return {
      sanctionsHit,
      pepHit,
      matchedLists,
      checkedAt: new Date(),
      provider: this.name,
    };
  }
}

let kycInstance: KycProvider | null = null;
let sanctionsInstance: SanctionsProvider | null = null;

export function getKycProvider(): KycProvider {
  if (kycInstance) return kycInstance;
  switch (env.KYC_PROVIDER) {
    case 'mock':
      kycInstance = new MockKycProvider();
      return kycInstance;
    default:
      throw new Error(`No KycProvider implementation for "${env.KYC_PROVIDER}".`);
  }
}

export function getSanctionsProvider(): SanctionsProvider {
  if (sanctionsInstance) return sanctionsInstance;
  switch (env.SANCTIONS_PROVIDER) {
    case 'mock':
      sanctionsInstance = new MockSanctionsProvider();
      return sanctionsInstance;
    default:
      throw new Error(`No SanctionsProvider implementation for "${env.SANCTIONS_PROVIDER}".`);
  }
}

export function resetKycProviders(): void {
  kycInstance = null;
  sanctionsInstance = null;
  MockKycProvider.reset();
}
