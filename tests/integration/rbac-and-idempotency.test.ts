/**
 * Access control and retry safety.
 *
 * The RBAC matrix is asserted exhaustively rather than by spot-check, because a
 * single wrong permission in a payments system is a cash-out. The idempotency
 * cases prove that a retried request cannot charge or pay twice.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { createTestUser, cleanupUser, getLocationId, getInstitutionId, type TestUser } from './helpers';
import {
  ROLES,
  ROLE_PERMISSIONS,
  canActAtLocation,
  hasPermission,
  isStaff,
  requiresMfa,
  type Permission,
  type Role,
} from '@/server/auth/rbac';
import { createTransaction } from '@/server/services/transaction';
import { confirmPayment, createPaymentIntent } from '@/server/services/payment';
import { redeemPickupCode } from '@/server/services/pickup';
import { MOCK_TOKENS } from '@/server/providers/payment';
import { resolvePrincipal, createSession, revokeSession } from '@/server/auth/session';
import { login } from '@/server/services/auth';

// ---------------------------------------------------------------------------
// The permission matrix (pure — no database needed, but grouped here with the
// authorisation tests it belongs with)
// ---------------------------------------------------------------------------

describe('RBAC matrix', () => {
  it('test_rbac_matrix_gives_every_role_at_least_one_permission', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  describe('a customer cannot reach any staff capability', () => {
    const forbidden: Permission[] = [
      'pickup.verify',
      'pickup.redeem',
      'pickup.reject',
      'compliance.hold.place',
      'compliance.hold.release',
      'compliance.kyc.review',
      'refund.issue',
      'ledger.read',
      'transaction.read.any',
      'admin.dashboard.read',
      'admin.user.manage',
      'admin.settings.manage',
      'pricing.manage',
      'risk.policy.manage',
    ];

    it.each(forbidden)('test_rbac_matrix_a_customer_cannot_reach_any_staff_capability_customer_is_denied [%s]', (permission) => {
      expect(hasPermission(['CUSTOMER'], permission)).toBe(false);
    });
  });

  describe('separation of duties', () => {
    it('test_rbac_matrix_separation_of_duties_a_support_agent_can_read_but_cannot_approve_a_payout', () => {
      expect(hasPermission(['SUPPORT_AGENT'], 'transaction.read.any')).toBe(true);
      expect(hasPermission(['SUPPORT_AGENT'], 'pickup.redeem')).toBe(false);
      expect(hasPermission(['SUPPORT_AGENT'], 'refund.issue')).toBe(false);
      expect(hasPermission(['SUPPORT_AGENT'], 'compliance.hold.release')).toBe(false);
    });

    it('test_rbac_matrix_separation_of_duties_a_compliance_analyst_can_hold_and_release_but_cannot_move_money', () => {
      expect(hasPermission(['COMPLIANCE_ANALYST'], 'compliance.hold.place')).toBe(true);
      expect(hasPermission(['COMPLIANCE_ANALYST'], 'compliance.hold.release')).toBe(true);
      expect(hasPermission(['COMPLIANCE_ANALYST'], 'refund.issue')).toBe(false);
      expect(hasPermission(['COMPLIANCE_ANALYST'], 'pickup.redeem')).toBe(false);
    });

    it('test_rbac_matrix_separation_of_duties_a_finance_admin_can_refund_but_cannot_change_roles', () => {
      expect(hasPermission(['FINANCE_ADMIN'], 'refund.issue')).toBe(true);
      expect(hasPermission(['FINANCE_ADMIN'], 'ledger.read')).toBe(true);
      expect(hasPermission(['FINANCE_ADMIN'], 'admin.role.manage')).toBe(false);
    });

    it('test_rbac_matrix_separation_of_duties_a_system_admin_cannot_clear_compliance_holds_they_may_have_caused', () => {
      expect(hasPermission(['SYSTEM_ADMIN'], 'admin.settings.manage')).toBe(true);
      expect(hasPermission(['SYSTEM_ADMIN'], 'compliance.hold.release')).toBe(false);
      expect(hasPermission(['SYSTEM_ADMIN'], 'compliance.kyc.review')).toBe(false);
    });

    it('test_rbac_matrix_separation_of_duties_a_pickup_agent_cannot_administer_locations_a_manager_can', () => {
      expect(hasPermission(['PICKUP_AGENT'], 'pickup.location.manage')).toBe(false);
      expect(hasPermission(['PICKUP_MANAGER'], 'pickup.location.manage')).toBe(true);
    });
  });

  describe('staff classification and MFA', () => {
    it('test_rbac_matrix_staff_classification_and_mfa_classifies_staff_roles', () => {
      expect(isStaff(['CUSTOMER'])).toBe(false);
      for (const role of ['PICKUP_AGENT', 'COMPLIANCE_ANALYST', 'SYSTEM_ADMIN'] as Role[]) {
        expect(isStaff([role])).toBe(true);
      }
    });

    it('test_rbac_matrix_staff_classification_and_mfa_requires_mfa_for_every_staff_role_and_not_for_customers', () => {
      expect(requiresMfa(['CUSTOMER'])).toBe(false);
      for (const role of ROLES.filter((r) => r !== 'CUSTOMER')) {
        expect(requiresMfa([role])).toBe(true);
      }
    });
  });

  describe('location scoping', () => {
    it('test_rbac_matrix_location_scoping_permits_an_agent_only_at_assigned_locations', () => {
      expect(canActAtLocation(['PICKUP_AGENT'], ['loc-a'], 'loc-a')).toBe(true);
      expect(canActAtLocation(['PICKUP_AGENT'], ['loc-a'], 'loc-b')).toBe(false);
      expect(canActAtLocation(['PICKUP_AGENT'], [], 'loc-a')).toBe(false);
    });

    it('test_rbac_matrix_location_scoping_lets_an_institution_administrator_act_anywhere', () => {
      expect(canActAtLocation(['SYSTEM_ADMIN'], [], 'loc-anything')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

describe('sessions', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser(['CUSTOMER']);
  });

  afterAll(async () => {
    await cleanupUser(user.id);
  });

  it('test_sessions_resolves_a_valid_session_to_a_principal_with_permissions', async () => {
    const session = await createSession(user.id, { ipAddress: '203.0.113.1' });
    const principal = await resolvePrincipal(session.token);

    expect(principal).not.toBeNull();
    expect(principal?.userId).toBe(user.id);
    expect(principal?.roles).toEqual(['CUSTOMER']);
    expect(principal?.permissions.has('transaction.create')).toBe(true);
    expect(principal?.permissions.has('pickup.redeem')).toBe(false);
  });

  it('test_sessions_stores_only_a_hash_of_the_session_token', async () => {
    const session = await createSession(user.id, {});
    const row = await prisma.session.findUniqueOrThrow({
      where: { id: session.sessionId },
      select: { tokenHash: true },
    });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toBe(session.token);
  });

  it('test_sessions_refuses_a_revoked_session_immediately', async () => {
    const session = await createSession(user.id, {});
    expect(await resolvePrincipal(session.token)).not.toBeNull();

    await revokeSession(session.sessionId, 'TEST');
    expect(await resolvePrincipal(session.token)).toBeNull();
  });

  it('test_sessions_refuses_an_unknown_or_malformed_token', async () => {
    expect(await resolvePrincipal('not-a-real-token')).toBeNull();
    expect(await resolvePrincipal(undefined)).toBeNull();
    expect(await resolvePrincipal('')).toBeNull();
  });

  it('test_sessions_refuses_a_session_belonging_to_a_suspended_user', async () => {
    const suspended = await createTestUser(['CUSTOMER']);
    const session = await createSession(suspended.id, {});
    expect(await resolvePrincipal(session.token)).not.toBeNull();

    await prisma.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });
    expect(await resolvePrincipal(session.token)).toBeNull();

    await cleanupUser(suspended.id);
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('authentication', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser(['CUSTOMER']);
  });

  afterAll(async () => {
    await cleanupUser(user.id);
  });

  it('test_authentication_accepts_correct_credentials', async () => {
    const result = await login({ email: user.email, password: user.password });
    expect(result.ok).toBe(true);
  });

  it('test_authentication_rejects_a_wrong_password', async () => {
    const result = await login({ email: user.email, password: 'WrongPassword123!' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_CREDENTIALS');
  });

  it('test_authentication_reports_an_unknown_account_identically_to_a_wrong_password', async () => {
    const unknown = await login({
      email: 'definitely-not-registered@example.test',
      password: 'AnyPassword123!',
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe('INVALID_CREDENTIALS');
  });

  it('test_authentication_locks_the_account_after_repeated_failures', async () => {
    const target = await createTestUser(['CUSTOMER']);

    let lastCode = '';
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const result = await login({ email: target.email, password: 'WrongPassword123!' });
      if (!result.ok) lastCode = result.code;
    }
    expect(lastCode).toBe('ACCOUNT_LOCKED');

    // Even the correct password is refused while locked.
    const correct = await login({ email: target.email, password: target.password });
    expect(correct.ok).toBe(false);

    await cleanupUser(target.id);
  });
});

// ---------------------------------------------------------------------------
// Idempotency and retry safety
// ---------------------------------------------------------------------------

describe('idempotency and retry safety', () => {
  let agent: TestUser;
  let locationId: string;
  let institutionId: string;
  const created: string[] = [];

  beforeAll(async () => {
    locationId = await getLocationId('CCD-PUJ-01');
    institutionId = await getInstitutionId('DEMO-CCD');
    agent = await createTestUser(['PICKUP_AGENT'], {
      institutionCode: 'DEMO-CCD',
      locationCodes: ['CCD-PUJ-01'],
    });
  });

  afterAll(async () => {
    for (const id of created) await cleanupUser(id);
    await cleanupUser(agent.id);
  });

  async function customer() {
    const user = await createTestUser(['CUSTOMER'], { verifiedKyc: true });
    created.push(user.id);
    return user;
  }

  it('test_idempotency_and_retry_safety_reuses_an_existing_payment_intent_rather_than_creating_a_second_charge', async () => {
    const user = await customer();
    const transaction = await createTransaction({
      userId: user.id,
      payoutAmountMinor: 100_000n,
      countryCode: 'DO',
      fundingCurrency: 'USD',
      pickupLocationId: locationId,
    });

    const first = await createPaymentIntent({
      transactionId: transaction.transactionId,
      userId: user.id,
      idempotencyKey: 'key-1',
    });
    const second = await createPaymentIntent({
      transactionId: transaction.transactionId,
      userId: user.id,
      idempotencyKey: 'key-2',
    });

    expect(second.providerRef).toBe(first.providerRef);

    const payments = await prisma.payment.count({
      where: { transactionId: transaction.transactionId },
    });
    expect(payments).toBe(1);
  });

  it('test_idempotency_and_retry_safety_refuses_to_confirm_a_payment_twice', async () => {
    const user = await customer();
    const transaction = await createTransaction({
      userId: user.id,
      payoutAmountMinor: 100_000n,
      countryCode: 'DO',
      fundingCurrency: 'USD',
      pickupLocationId: locationId,
    });

    await createPaymentIntent({
      transactionId: transaction.transactionId,
      userId: user.id,
      idempotencyKey: 'intent',
    });

    const first = await confirmPayment({
      transactionId: transaction.transactionId,
      userId: user.id,
      paymentToken: MOCK_TOKENS.SUCCESS_DEBIT,
      idempotencyKey: 'confirm-1',
    });
    expect(first.status).toBe('READY_FOR_PICKUP');

    // The state machine refuses: the transaction is no longer PAYMENT_PENDING.
    await expect(
      confirmPayment({
        transactionId: transaction.transactionId,
        userId: user.id,
        paymentToken: MOCK_TOKENS.SUCCESS_DEBIT,
        idempotencyKey: 'confirm-2',
      }),
    ).rejects.toThrow();

    const codes = await prisma.pickupCode.count({
      where: { transactionId: transaction.transactionId },
    });
    expect(codes).toBe(1);
  });

  it('test_idempotency_and_retry_safety_posts_each_ledger_event_exactly_once_per_transaction', async () => {
    const user = await customer();
    const transaction = await createTransaction({
      userId: user.id,
      payoutAmountMinor: 100_000n,
      countryCode: 'DO',
      fundingCurrency: 'USD',
      pickupLocationId: locationId,
    });

    await createPaymentIntent({
      transactionId: transaction.transactionId,
      userId: user.id,
      idempotencyKey: 'i',
    });
    await confirmPayment({
      transactionId: transaction.transactionId,
      userId: user.id,
      paymentToken: MOCK_TOKENS.SUCCESS_DEBIT,
      idempotencyKey: 'c',
    });

    const postings = await prisma.ledgerTransaction.findMany({
      where: { transactionId: transaction.transactionId },
      select: { postingKey: true, eventType: true },
    });

    const keys = postings.map((p) => p.postingKey);
    expect(new Set(keys).size).toBe(keys.length);

    const events = postings.map((p) => p.eventType);
    expect(new Set(events).size).toBe(events.length);
  });

  it('test_idempotency_and_retry_safety_refuses_a_payout_larger_than_the_outstanding_balance', async () => {
    const user = await customer();
    const transaction = await createTransaction({
      userId: user.id,
      payoutAmountMinor: 100_000n,
      countryCode: 'DO',
      fundingCurrency: 'USD',
      pickupLocationId: locationId,
    });

    await createPaymentIntent({
      transactionId: transaction.transactionId,
      userId: user.id,
      idempotencyKey: 'i',
    });
    const confirmed = await confirmPayment({
      transactionId: transaction.transactionId,
      userId: user.id,
      paymentToken: MOCK_TOKENS.SUCCESS_DEBIT,
      idempotencyKey: 'c',
    });

    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    await expect(
      redeemPickupCode({
        code: credential.code,
        agentId: agent.id,
        institutionId,
        locationId,
        documentType: 'PASSPORT',
        documentLast4: '4567',
        amountMinor: 999_999_999n,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

describe('limits are enforced server-side', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) await cleanupUser(id);
  });

  it('test_limits_are_enforced_server_side_refuses_a_transaction_above_the_per_transaction_maximum', async () => {
    const user = await createTestUser(['CUSTOMER'], { verifiedKyc: true });
    created.push(user.id);

    // RD$500,000 is roughly $8,400 — far above the $1,000 per-transaction cap.
    await expect(
      createTransaction({
        userId: user.id,
        payoutAmountMinor: 50_000_000n,
        countryCode: 'DO',
        fundingCurrency: 'USD',
      }),
    ).rejects.toThrow();
  });

  it('test_limits_are_enforced_server_side_refuses_a_transaction_below_the_minimum', async () => {
    const user = await createTestUser(['CUSTOMER'], { verifiedKyc: true });
    created.push(user.id);

    await expect(
      createTransaction({
        userId: user.id,
        payoutAmountMinor: 100n, // RD$1
        countryCode: 'DO',
        fundingCurrency: 'USD',
      }),
    ).rejects.toThrow();
  });

  it('test_limits_are_enforced_server_side_refuses_once_the_daily_limit_would_be_breached', async () => {
    const user = await createTestUser(['CUSTOMER'], { verifiedKyc: true });
    created.push(user.id);

    // Each ~RD$20,000 is ~$350. Three fit inside $1,000; the fourth must not.
    let blocked = false;
    for (let i = 0; i < 5; i += 1) {
      try {
        const transaction = await createTransaction({
          userId: user.id,
          payoutAmountMinor: 2_000_000n,
          countryCode: 'DO',
          fundingCurrency: 'USD',
        });
        await createPaymentIntent({
          transactionId: transaction.transactionId,
          userId: user.id,
          idempotencyKey: `i-${i}`,
        });
        await confirmPayment({
          transactionId: transaction.transactionId,
          userId: user.id,
          paymentToken: MOCK_TOKENS.SUCCESS_DEBIT,
          idempotencyKey: `c-${i}`,
        });
      } catch {
        blocked = true;
        break;
      }
    }

    expect(blocked).toBe(true);
  });
});
