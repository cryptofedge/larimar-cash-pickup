/**
 * End-to-end demonstration of the complete transaction lifecycle.
 *
 * Drives the real services against the real database — no mocking beyond the
 * external financial providers themselves. If this script completes, the whole
 * platform works: pricing, risk, KYC, payment, ledger, code issuance, agent
 * verification, disbursement, and ledger integrity.
 *
 *   npm run demo
 */

import { prisma } from '../src/server/db';
import { formatMoney, fromMinor } from '../src/lib/domain/money';
import { formatRate } from '../src/lib/domain/fx';
import { maskCode } from '../src/lib/domain/pickup-code';
import { createTransaction } from '../src/server/services/transaction';
import { submitKyc } from '../src/server/services/compliance';
import { createPaymentIntent, confirmPayment } from '../src/server/services/payment';
import { verifyPickupCode, redeemPickupCode } from '../src/server/services/pickup';
import {
  verifyLedgerIntegrity,
  getAccountBalances,
  getLedgerEntriesForTransaction,
} from '../src/server/services/ledger';
import { flushNotifications } from '../src/server/services/notification';
import { MOCK_TOKENS } from '../src/server/providers/payment';

const line = (char = '─') => console.log(char.repeat(72));
const step = (n: number, title: string) => {
  console.log('');
  line();
  console.log(`STEP ${n}: ${title}`);
  line();
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error(`\n  FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function main(): Promise<void> {
  console.log('');
  console.log('  LARIMAR — end-to-end demonstration');
  console.log('  DEMO MODE. No real money moves. No real card is charged.');

  // --- Setup ------------------------------------------------------------
  const customer = await prisma.user.findUnique({
    where: { email: 'customer@example.com' },
    select: { id: true, email: true },
  });
  const agent = await prisma.user.findUnique({
    where: { email: 'agent@example.com' },
    select: { id: true, institutionId: true, agentLocations: { select: { locationId: true } } },
  });

  if (!customer || !agent) {
    console.error('\n  Demo users not found. Run `npm run db:seed` first.');
    process.exit(1);
  }

  const agentLocationId = agent.agentLocations[0]?.locationId;
  assert(agentLocationId !== undefined, 'Agent has an authorised payout location');

  // Clear prior demo runs so the script is repeatable.
  await prisma.transaction.deleteMany({ where: { userId: customer.id } });
  await prisma.identityVerification.deleteMany({ where: { userId: customer.id } });

  // --- 1. Quote and create ---------------------------------------------
  step(1, 'Customer requests RD$20,000');

  const created = await createTransaction({
    userId: customer.id,
    payoutAmountMinor: 2_000_000n, // RD$20,000.00
    countryCode: 'DO',
    fundingCurrency: 'USD',
    pickupLocationId: agentLocationId,
    ipAddress: '203.0.113.10',
    ipCountry: 'US',
  });

  const quote = await prisma.quote.findUniqueOrThrow({ where: { id: created.quoteId } });

  console.log('');
  console.log(`  Reference        ${created.reference}`);
  console.log(`  YOU RECEIVE      ${formatMoney(fromMinor(quote.payoutAmountMinor, 'DOP'))}`);
  console.log(`  Amount           ${formatMoney(fromMinor(quote.principalMinor, 'USD'))}`);
  console.log(`  Exchange rate    1 USD = ${formatRate(quote.effectiveRate, 4)} DOP`);
  console.log(`  Platform fee     ${formatMoney(fromMinor(quote.platformFeeMinor, 'USD'))}`);
  console.log(`  Processing fee   ${formatMoney(fromMinor(quote.processingFeeMinor, 'USD'))}`);
  console.log(`  YOU PAY          ${formatMoney(fromMinor(quote.totalChargedMinor, 'USD'))}`);
  console.log(`  Risk             ${created.risk.level} (score ${created.risk.score})`);
  console.log('');

  assert(
    quote.principalMinor + quote.platformFeeMinor + quote.processingFeeMinor + quote.expeditedFeeMinor ===
      quote.totalChargedMinor,
    'Quote components sum exactly to the total charged',
  );
  assert(created.status === 'KYC_REQUIRED', 'Amount over the threshold routed to identity verification');

  // --- 2. KYC -----------------------------------------------------------
  step(2, 'Identity verification');

  const kyc = await submitKyc({
    userId: customer.id,
    firstName: 'John',
    lastName: 'Traveler',
    dateOfBirth: '1985-04-12',
    documentType: 'PASSPORT',
    documentNumber: 'X1234567',
    documentCountry: 'US',
    residenceCountry: 'US',
    transactionId: created.transactionId,
  });

  assert(kyc.status === 'APPROVED', 'Verification approved (simulated)');

  const verification = await prisma.identityVerification.findUniqueOrThrow({
    where: { id: kyc.verificationId },
    select: { documentLast4: true },
  });
  assert(
    verification.documentLast4 === '4567',
    'Only the last 4 of the document number is stored, never the full number',
  );

  let current = await prisma.transaction.findUniqueOrThrow({
    where: { id: created.transactionId },
    select: { status: true },
  });
  assert(current.status === 'PAYMENT_PENDING', 'Transaction advanced to awaiting payment');

  // --- 3. Payment -------------------------------------------------------
  step(3, 'Payment (simulated, tokenised)');

  const intent = await createPaymentIntent({
    transactionId: created.transactionId,
    userId: customer.id,
    idempotencyKey: `demo-intent-${created.reference}`,
  });
  console.log(`  Payment intent   ${intent.providerRef}`);
  console.log(`  Charging         ${formatMoney(fromMinor(BigInt(intent.amountMinor), intent.currency))}`);

  const confirmed = await confirmPayment({
    transactionId: created.transactionId,
    userId: customer.id,
    paymentToken: MOCK_TOKENS.SUCCESS_DEBIT,
    idempotencyKey: `demo-confirm-${created.reference}`,
    ipAddress: '203.0.113.10',
  });

  assert(confirmed.status === 'READY_FOR_PICKUP', 'Payment captured and cleared automatically');
  assert(confirmed.credential !== undefined, 'Pickup credential issued');

  const credential = confirmed.credential;
  if (!credential) process.exit(1);

  const storedCode = await prisma.pickupCode.findUniqueOrThrow({
    where: { transactionId: created.transactionId },
    select: { codeHash: true },
  });
  assert(
    !storedCode.codeHash.includes(credential.code.replace(/-/g, '')),
    'The plaintext code is not recoverable from the database',
  );

  // --- 4. The pickup code ----------------------------------------------
  step(4, 'Pickup code issued');
  console.log('');
  console.log(`      PICKUP CODE      ${credential.code}`);
  console.log(`      Amount           ${formatMoney(fromMinor(quote.payoutAmountMinor, 'DOP'))}`);
  console.log(`      Valid until      ${credential.expiresAt.toISOString().slice(0, 10)}`);
  console.log(`      (logged as       ${maskCode(credential.code)})`);
  console.log('');

  // --- 5. Agent verification -------------------------------------------
  step(5, 'Agent verifies the code at the payout window');

  const wrongCode = await verifyPickupCode({
    code: 'DR-0000-0000',
    agentId: agent.id,
    institutionId: agent.institutionId,
    locationId: agentLocationId,
    ipAddress: '198.51.100.5',
  });
  assert(!wrongCode.ok, 'An incorrect code is rejected');

  const verified = await verifyPickupCode({
    code: credential.code,
    secret: credential.secret,
    agentId: agent.id,
    institutionId: agent.institutionId,
    locationId: agentLocationId,
    ipAddress: '198.51.100.5',
  });

  assert(verified.ok, 'The correct code verifies');
  if (!verified.ok) process.exit(1);

  console.log('');
  console.log('  What the agent sees:');
  console.log(`    Reference        ${verified.view.reference}`);
  console.log(`    Amount to pay    ${formatMoney(fromMinor(BigInt(verified.view.remainingMinor), verified.view.payoutCurrency))}`);
  console.log(`    Accepted ID      ${verified.view.acceptedDocuments.join(', ')}`);
  console.log(`    Compliance       ${verified.view.complianceCleared ? 'Clear' : 'ON HOLD'}`);
  console.log(`    Location         ${verified.view.institutionName}`);
  console.log('');

  const agentViewKeys = Object.keys(verified.view);
  const leakedFields = agentViewKeys.filter((k) =>
    ['email', 'firstName', 'lastName', 'phone', 'address', 'cardLast4', 'totalCharged', 'userId'].includes(k),
  );
  assert(leakedFields.length === 0, 'The agent view contains no customer personal information');

  // --- 6. Disbursement --------------------------------------------------
  step(6, 'Agent disburses the cash');

  const redeemed = await redeemPickupCode({
    code: credential.code,
    agentId: agent.id,
    institutionId: agent.institutionId,
    locationId: agentLocationId,
    documentType: 'PASSPORT',
    documentLast4: '4567',
    amountMinor: 2_000_000n,
    ipAddress: '198.51.100.5',
  });

  assert(redeemed.fullyPaid, `Disbursed ${formatMoney(fromMinor(redeemed.paidMinor, 'DOP'))} in full`);

  current = await prisma.transaction.findUniqueOrThrow({
    where: { id: created.transactionId },
    select: { status: true },
  });
  assert(current.status === 'PICKED_UP', 'Transaction is COMPLETED (PICKED_UP)');

  // --- 7. Single-use enforcement ---------------------------------------
  step(7, 'The code cannot be redeemed twice');

  let secondRedemptionRejected = false;
  try {
    await redeemPickupCode({
      code: credential.code,
      agentId: agent.id,
      institutionId: agent.institutionId,
      locationId: agentLocationId,
      documentType: 'PASSPORT',
      documentLast4: '4567',
      amountMinor: 2_000_000n,
    });
  } catch {
    secondRedemptionRejected = true;
  }
  assert(secondRedemptionRejected, 'A second redemption attempt is refused');

  // --- 8. Ledger --------------------------------------------------------
  step(8, 'Ledger integrity');

  const integrity = await verifyLedgerIntegrity();
  assert(integrity.balanced, 'Every currency balances: total debits equal total credits');

  // Balances are computed for THIS transaction rather than platform-wide, so the
  // assertions stay meaningful in a database that also holds test data.
  const postings = await getLedgerEntriesForTransaction(created.transactionId);
  const perAccount = new Map<string, { minor: bigint; currency: string; type: string }>();

  for (const posting of postings) {
    for (const entry of posting.entries) {
      const normalDebit = entry.account.type === 'ASSET' || entry.account.type === 'EXPENSE';
      const signed =
        (normalDebit ? entry.direction === 'DEBIT' : entry.direction === 'CREDIT')
          ? entry.amountMinor
          : -entry.amountMinor;
      const current = perAccount.get(entry.account.code) ?? {
        minor: 0n,
        currency: entry.currency,
        type: entry.account.type,
      };
      perAccount.set(entry.account.code, { ...current, minor: current.minor + signed });
    }
  }

  console.log('');
  for (const [code, balance] of [...perAccount.entries()].filter(([, b]) => b.minor !== 0n)) {
    const formatted = formatMoney(fromMinor(balance.minor, balance.currency), 'en-US', {
      showCode: true,
    });
    console.log(`    ${code.padEnd(34)} ${formatted.padStart(18)}`);
  }
  console.log('');

  assert(
    (perAccount.get('LIAB_CUSTOMER_FUNDS_USD')?.minor ?? 0n) === 0n,
    'Customer funds suspense is fully cleared',
  );
  assert(
    (perAccount.get('LIAB_PAYOUT_DOP')?.minor ?? 0n) === 0n,
    'The payout obligation is discharged',
  );
  assert(
    perAccount.get('LIAB_PARTNER_SETTLEMENT_DOP')?.minor === 2_000_000n,
    'RD$20,000 is now payable to the payout partner',
  );

  const revenue = [...perAccount.values()]
    .filter((b) => b.type === 'REVENUE')
    .reduce((total, b) => total + b.minor, 0n);
  console.log(`    Revenue recognised on this transaction: ${formatMoney(fromMinor(revenue, 'USD'))}`);

  // Platform-wide sanity: no custodial account may ever hold a negative balance.
  const allBalances = await getAccountBalances();
  const negativeCustodial = allBalances.filter((b) => b.isCustodial && b.balanceMinor < 0n);
  assert(
    negativeCustodial.length === 0,
    'No custodial account holds a negative balance platform-wide',
  );

  // --- 9. Audit trail ---------------------------------------------------
  step(9, 'Audit and event trail');

  const events = await prisma.transactionEvent.findMany({
    where: { transactionId: created.transactionId },
    orderBy: { createdAt: 'asc' },
    select: { fromStatus: true, toStatus: true, actorType: true },
  });

  console.log('');
  for (const event of events) {
    console.log(`    ${(event.fromStatus ?? '—').padEnd(26)} -> ${event.toStatus.padEnd(20)} (${event.actorType})`);
  }
  console.log('');

  const auditCount = await prisma.auditLog.count({
    where: { resourceId: created.transactionId },
  });
  assert(auditCount > 0, `${auditCount} audit records written for this transaction`);

  const notifications = await flushNotifications();
  console.log(`  ✓ ${notifications.sent} notifications dispatched (mock transport)`);

  // --- Done -------------------------------------------------------------
  console.log('');
  line('═');
  console.log('  END-TO-END DEMONSTRATION PASSED');
  line('═');
  console.log('');
  console.log(`  ${created.reference}: RD$20,000 requested -> paid -> code issued -> cash collected.`);
  console.log('  Reminder: every provider was simulated and every location is fictional.');
  console.log('');
}

main()
  .catch((error) => {
    console.error('\nDemo failed:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
