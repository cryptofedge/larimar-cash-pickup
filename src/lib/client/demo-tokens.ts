/**
 * Demo payment scenario tokens.
 *
 * Mirrors `MOCK_TOKENS` in src/server/providers/payment.ts. Kept as a separate
 * client-safe module so the checkout UI can offer the scenarios without pulling
 * the server provider — and its `node:crypto` imports — into the browser bundle.
 *
 * These are NOT card numbers and never touch a real network. They stand in for
 * the opaque token a real provider's hosted fields would return.
 */

export const MOCK_TOKENS = {
  SUCCESS_DEBIT: 'tok_demo_visa_debit_ok',
  SUCCESS_CREDIT: 'tok_demo_mc_credit_ok',
  DECLINE_FUNDS: 'tok_demo_decline_insufficient_funds',
  DECLINE_FRAUD: 'tok_demo_decline_suspected_fraud',
  DECLINE_EXPIRED: 'tok_demo_decline_expired_card',
  REQUIRES_3DS: 'tok_demo_requires_3ds',
} as const;
