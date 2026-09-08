import Link from 'next/link';
import { getTranslations, formatDate } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { listTransactionsForUser } from '@/server/services/transaction';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES } from '@/i18n/config';
import { Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { STATUS_MESSAGE_KEYS, type TransactionStatus } from '@/lib/domain/transaction-state';

export const metadata = { title: 'Transactions' };
export const dynamic = 'force-dynamic';

export default async function TransactionsPage() {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const intl = INTL_LOCALES[locale];
  const transactions = await listTransactionsForUser(principal.userId, { limit: 50 });

  const statusLabel = (status: TransactionStatus): string => {
    const key = STATUS_MESSAGE_KEYS[status].split('.')[1] as keyof typeof m.status;
    return m.status[key];
  };

  return (
    <div>
      <PageHeader
        title={m.transaction.historyTitle}
        action={
          <Link href="/new" className="btn-primary">
            {m.dashboard.newPickup}
          </Link>
        }
      />

      <Card>
        {transactions.length === 0 ? (
          <EmptyState
            title={m.transaction.historyEmpty}
            action={
              <Link href="/new" className="btn-primary">
                {m.dashboard.newPickup}
              </Link>
            }
          />
        ) : (
          <>
            {/* Cards on mobile, a table from md up — a phone cannot show 6 columns. */}
            <ul className="divide-y divide-navy-100 md:hidden">
              {transactions.map((t) => (
                <li key={t.id}>
                  <Link href={`/transactions/${t.id}`} className="block p-4 hover:bg-navy-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="tabular font-semibold text-navy-900">
                          {formatMoney(fromMinor(t.payoutAmountMinor, t.payoutCurrency), intl)}
                        </p>
                        <p className="mt-0.5 text-xs text-navy-400">{t.reference}</p>
                        <p className="mt-1 truncate text-sm text-navy-500">
                          {t.pickupLocation ? `${t.pickupLocation.branchName}, ${t.pickupLocation.city}` : '—'}
                        </p>
                      </div>
                      <StatusBadge
                        status={t.status as TransactionStatus}
                        label={statusLabel(t.status as TransactionStatus)}
                      />
                    </div>
                    <p className="mt-2 text-xs text-navy-400">{formatDate(t.createdAt, locale)}</p>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-navy-100 bg-navy-50/50 text-left text-xs uppercase tracking-wide text-navy-400">
                  <tr>
                    <th className="px-5 py-3 font-medium">{m.common.reference}</th>
                    <th className="px-5 py-3 font-medium">{m.calculator.youReceive}</th>
                    <th className="px-5 py-3 font-medium">{m.calculator.youPay}</th>
                    <th className="px-5 py-3 font-medium">{m.common.location}</th>
                    <th className="px-5 py-3 font-medium">{m.common.status}</th>
                    <th className="px-5 py-3 font-medium">{m.common.date}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-navy-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/transactions/${t.id}`}
                          className="font-medium text-larimar-700 hover:underline"
                        >
                          {t.reference}
                        </Link>
                      </td>
                      <td className="tabular px-5 py-3 font-semibold text-navy-900">
                        {formatMoney(fromMinor(t.payoutAmountMinor, t.payoutCurrency), intl)}
                      </td>
                      <td className="tabular px-5 py-3 text-navy-600">
                        {formatMoney(fromMinor(t.totalChargedMinor, t.fundingCurrency), intl)}
                      </td>
                      <td className="px-5 py-3 text-navy-600">
                        {t.pickupLocation ? `${t.pickupLocation.branchName}, ${t.pickupLocation.city}` : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge
                          status={t.status as TransactionStatus}
                          label={statusLabel(t.status as TransactionStatus)}
                        />
                      </td>
                      <td className="px-5 py-3 text-navy-500">{formatDate(t.createdAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
