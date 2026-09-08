import { getTranslations } from '@/i18n';
import { getAccountBalances, verifyLedgerIntegrity } from '@/server/services/ledger';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES } from '@/i18n/config';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { prisma } from '@/server/db';

export const metadata = { title: 'Ledger' };
export const dynamic = 'force-dynamic';

export default async function LedgerPage() {
  const { m, locale } = await getTranslations();
  const intl = INTL_LOCALES[locale];

  const [balances, integrity, recent] = await Promise.all([
    getAccountBalances(),
    verifyLedgerIntegrity(),
    prisma.ledgerTransaction.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 25,
      include: {
        entries: { include: { account: { select: { code: true, name: true } } } },
        transaction: { select: { reference: true } },
      },
    }),
  ]);

  const byType = new Map<string, typeof balances>();
  for (const balance of balances) {
    const list = byType.get(balance.type) ?? [];
    list.push(balance);
    byType.set(balance.type, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={m.admin.ledger} />

      {integrity.balanced ? (
        <Alert tone="success" title={m.admin.ledgerIntegrity}>
          {m.admin.ledgerBalanced}
        </Alert>
      ) : (
        <Alert tone="danger" title={m.admin.ledgerIntegrity}>
          {m.admin.ledgerImbalanced}
          <ul className="mt-2 space-y-1">
            {integrity.imbalances.map((imbalance) => (
              <li key={imbalance.currency} className="tabular font-mono text-xs">
                {imbalance.currency}: {imbalance.deltaMinor.toString()}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {[...byType.entries()].map(([type, accounts]) => (
          <Card key={type}>
            <CardHeader title={type} />
            <ul className="divide-y divide-navy-100">
              {accounts.map((account) => (
                <li key={account.accountCode} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">
                      {account.accountName}
                    </p>
                    <p className="truncate font-mono text-xs text-navy-400">{account.accountCode}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {account.isCustodial ? <Badge tone="info">Custodial</Badge> : null}
                    <span className="tabular font-semibold text-navy-900">
                      {formatMoney(fromMinor(account.balanceMinor, account.currency), intl, {
                        showCode: true,
                      })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Recent postings"
          description="Append-only. Corrections are reversing entries, never edits."
        />
        {recent.length === 0 ? (
          <EmptyState title={m.admin.noResults} />
        ) : (
          <ul className="divide-y divide-navy-100">
            {recent.map((ledgerTransaction) => (
              <li key={ledgerTransaction.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Badge tone="neutral">{ledgerTransaction.eventType}</Badge>
                    <span className="ml-2 text-sm text-navy-600">
                      {ledgerTransaction.description}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-navy-400">
                    {ledgerTransaction.transaction?.reference ?? ledgerTransaction.reference}
                  </span>
                </div>

                <table className="mt-3 w-full text-xs">
                  <tbody>
                    {ledgerTransaction.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="py-1 pr-4 font-mono text-navy-500">{entry.account.code}</td>
                        <td className="py-1 pr-4">
                          <span
                            className={
                              entry.direction === 'DEBIT' ? 'text-larimar-700' : 'text-navy-500'
                            }
                          >
                            {entry.direction}
                          </span>
                        </td>
                        <td className="tabular py-1 text-right font-medium text-navy-900">
                          {formatMoney(fromMinor(entry.amountMinor, entry.currency), intl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
