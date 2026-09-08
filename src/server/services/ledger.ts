/**
 * Ledger persistence.
 *
 * The domain builds and balances postings; this module writes them. Two guards
 * stand between a posting and the database:
 *
 *   1. `assertBalanced` runs again here, immediately before the write. The domain
 *      builders already call it, but this is the last line of defence and it is
 *      cheap.
 *   2. `postingKey` is UNIQUE. Replaying the same business event — a retried
 *      webhook, a double-clicked button, a redelivered queue message — is a
 *      constraint violation, not a duplicate set of entries.
 */

import { prisma, isUniqueViolation, type PrismaTransactionClient } from '../db';
import { DomainError } from '@/lib/domain/errors';
import {
  CHART_OF_ACCOUNTS,
  assertBalanced,
  computeBalances,
  verifyGlobalBalance,
  type LedgerPosting,
} from '@/lib/domain/ledger';
import { generateReference } from '../auth/crypto';

/** Idempotent: creates the chart of accounts if it is not already present. */
export async function ensureChartOfAccounts(
  client: PrismaTransactionClient = prisma,
): Promise<void> {
  for (const account of CHART_OF_ACCOUNTS) {
    await client.ledgerAccount.upsert({
      where: { code: account.code },
      update: {
        name: account.name,
        type: account.type,
        currency: account.currency,
        normalBalance: account.normalBalance,
        isCustodial: account.isCustodial,
      },
      create: {
        code: account.code,
        name: account.name,
        type: account.type,
        currency: account.currency,
        normalBalance: account.normalBalance,
        isCustodial: account.isCustodial,
      },
    });
  }
}

export interface PostResult {
  readonly ledgerTransactionId: string;
  readonly reference: string;
  /** True when this exact posting had already been recorded. */
  readonly alreadyPosted: boolean;
}

/**
 * Write a posting.
 *
 * Must be called inside the same database transaction as the business change it
 * describes. A ledger entry that survives a rolled-back transaction, or a
 * business change with no ledger entry, are both unacceptable.
 */
export async function postLedgerTransaction(
  posting: LedgerPosting,
  options: { transactionId?: string | null; occurredAt?: Date },
  client: PrismaTransactionClient,
): Promise<PostResult> {
  assertBalanced(posting);

  const accounts = await client.ledgerAccount.findMany({
    where: { code: { in: posting.entries.map((e) => e.accountCode) } },
    select: { id: true, code: true },
  });
  const accountIdByCode = new Map(accounts.map((a) => [a.code, a.id]));

  for (const e of posting.entries) {
    if (!accountIdByCode.has(e.accountCode)) {
      throw new DomainError(
        'LEDGER_INVALID_ENTRY',
        `Ledger account ${e.accountCode} is not provisioned. Run ensureChartOfAccounts().`,
      );
    }
  }

  try {
    const created = await client.ledgerTransaction.create({
      data: {
        reference: generateReference('LDG'),
        eventType: posting.eventType,
        currency: posting.currency,
        description: posting.description,
        transactionId: options.transactionId ?? null,
        postingKey: posting.postingKey,
        occurredAt: options.occurredAt ?? new Date(),
        entries: {
          create: posting.entries.map((e) => ({
            accountId: accountIdByCode.get(e.accountCode) as string,
            direction: e.direction,
            amountMinor: e.amount.amount,
            currency: e.amount.currency,
            memo: e.memo ?? null,
          })),
        },
      },
      select: { id: true, reference: true },
    });

    return { ledgerTransactionId: created.id, reference: created.reference, alreadyPosted: false };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The event was already recorded. Return the original rather than raising,
      // so retries converge instead of failing.
      const existing = await client.ledgerTransaction.findUnique({
        where: { postingKey: posting.postingKey },
        select: { id: true, reference: true },
      });
      if (existing) {
        return {
          ledgerTransactionId: existing.id,
          reference: existing.reference,
          alreadyPosted: true,
        };
      }
    }
    throw error;
  }
}

/**
 * Reverse a posting by reading it back and writing flipped entries.
 *
 * Works from stored rows rather than a rebuilt domain object, so a correction
 * can be issued long after the original was written. The original is never
 * touched — `reversesId` links the two, and both remain in the history.
 */
export async function reverseLedgerTransaction(
  ledgerTransactionId: string,
  input: { reason: string; eventType?: LedgerPosting['eventType'] },
  client: PrismaTransactionClient,
): Promise<PostResult> {
  const original = await client.ledgerTransaction.findUnique({
    where: { id: ledgerTransactionId },
    include: { entries: true },
  });

  if (!original) {
    throw new DomainError('NOT_FOUND', `Ledger transaction ${ledgerTransactionId} not found`);
  }

  const postingKey = `${original.postingKey}:REVERSAL`;

  try {
    const created = await client.ledgerTransaction.create({
      data: {
        reference: generateReference('LDG'),
        eventType: input.eventType ?? 'ADJUSTMENT',
        currency: original.currency,
        description: `Reversal of ${original.postingKey}: ${input.reason}`,
        transactionId: original.transactionId,
        reversesId: original.id,
        postingKey,
        occurredAt: new Date(),
        entries: {
          create: original.entries.map((entry) => ({
            accountId: entry.accountId,
            direction: entry.direction === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const),
            amountMinor: entry.amountMinor,
            currency: entry.currency,
            memo: `Reversal: ${entry.memo ?? ''}`.trim(),
          })),
        },
      },
      select: { id: true, reference: true },
    });

    return { ledgerTransactionId: created.id, reference: created.reference, alreadyPosted: false };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await client.ledgerTransaction.findUnique({
        where: { postingKey },
        select: { id: true, reference: true },
      });
      if (existing) {
        return {
          ledgerTransactionId: existing.id,
          reference: existing.reference,
          alreadyPosted: true,
        };
      }
    }
    throw error;
  }
}

/**
 * Unwind every posting made for a transaction.
 *
 * Used when funds are returned before any cash was disbursed. Reversing the
 * whole chain is the only treatment that leaves every account economically
 * sensible: the fees are given back, the FX position is unwound, and the payout
 * obligation is cancelled.
 *
 * The naive alternative — debiting the customer-funds suspense account for the
 * refunded amount — balances arithmetically but drives a custodial liability
 * negative, because those funds were already allocated to fees and FX. A
 * negative customer-funds balance is not a rounding quirk; it is a
 * misstatement of what the platform is holding.
 */
export async function reverseAllPostingsForTransaction(
  transactionId: string,
  input: { reason: string; eventType?: LedgerPosting['eventType'] },
  client: PrismaTransactionClient,
): Promise<PostResult[]> {
  const postings = await client.ledgerTransaction.findMany({
    where: { transactionId, reversesId: null, reversedBy: { is: null } },
    orderBy: { occurredAt: 'desc' },
    select: { id: true },
  });

  const results: PostResult[] = [];
  for (const posting of postings) {
    results.push(await reverseLedgerTransaction(posting.id, input, client));
  }
  return results;
}

export async function postMany(
  postings: readonly LedgerPosting[],
  options: { transactionId?: string | null; occurredAt?: Date },
  client: PrismaTransactionClient,
): Promise<PostResult[]> {
  const results: PostResult[] = [];
  for (const posting of postings) {
    results.push(await postLedgerTransaction(posting, options, client));
  }
  return results;
}

export interface AccountBalance {
  readonly accountCode: string;
  readonly accountName: string;
  readonly type: string;
  readonly currency: string;
  readonly balanceMinor: bigint;
  readonly isCustodial: boolean;
}

export async function getAccountBalances(): Promise<AccountBalance[]> {
  const entries = await prisma.ledgerEntry.findMany({
    select: {
      direction: true,
      amountMinor: true,
      account: { select: { code: true, name: true, type: true, currency: true, isCustodial: true } },
    },
  });

  const balances = computeBalances(
    entries.map((e) => ({
      accountCode: e.account.code,
      direction: e.direction,
      amountMinor: e.amountMinor,
    })),
  );

  const meta = new Map(entries.map((e) => [e.account.code, e.account]));

  return balances.map((b) => {
    const account = meta.get(b.accountCode);
    return {
      accountCode: b.accountCode,
      accountName: account?.name ?? b.accountCode,
      type: b.type,
      currency: b.currency,
      balanceMinor: b.balanceMinor,
      isCustodial: account?.isCustodial ?? false,
    };
  });
}

/**
 * The integrity check an auditor would run: within every currency, total debits
 * equal total credits across the entire ledger. Exposed in the admin console and
 * asserted by the integration tests.
 */
export async function verifyLedgerIntegrity(): Promise<
  { balanced: true } | { balanced: false; imbalances: { currency: string; deltaMinor: bigint }[] }
> {
  const entries = await prisma.ledgerEntry.findMany({
    select: { accountId: true, direction: true, amountMinor: true, currency: true },
  });

  return verifyGlobalBalance(
    entries.map((e) => ({
      accountCode: 'IGNORED',
      direction: e.direction,
      amountMinor: e.amountMinor,
      currency: e.currency,
    })),
  );
}

export async function getLedgerEntriesForTransaction(transactionId: string) {
  return prisma.ledgerTransaction.findMany({
    where: { transactionId },
    include: {
      entries: { include: { account: { select: { code: true, name: true, type: true } } } },
    },
    orderBy: { occurredAt: 'asc' },
  });
}
