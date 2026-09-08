import Link from 'next/link';
import { getTranslations, formatDate } from '@/i18n';
import { searchTransactions } from '@/server/services/admin';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES } from '@/i18n/config';
import { Badge, Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import {
  STATUS_MESSAGE_KEYS,
  TRANSACTION_STATUSES,
  type TransactionStatus,
} from '@/lib/domain/transaction-state';

export const metadata = { title: 'Transactions' };
export const dynamic = 'force-dynamic';

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; riskLevel?: string }>;
}) {
  const { m, locale } = await getTranslations();
  const params = await searchParams;
  const intl = INTL_LOCALES[locale];

  const statuses = params.status
    ? [params.status].filter((s): s is TransactionStatus =>
        (TRANSACTION_STATUSES as readonly string[]).includes(s),
      )
    : undefined;

  const results = await searchTransactions({
    q: params.q,
    status: statuses,
    riskLevel: params.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | undefined,
    limit: 100,
  });

  const statusLabel = (status: string): string => {
    const key = STATUS_MESSAGE_KEYS[status as TransactionStatus]?.split('.')[1] as
      | keyof typeof m.status
      | undefined;
    return key ? m.status[key] : status;
  };

  const riskTone = (level: string) =>
    level === 'CRITICAL' ? 'danger' : level === 'HIGH' ? 'warning' : level === 'MEDIUM' ? 'info' : 'neutral';

  return (
    <div className="space-y-6">
      <PageHeader title={m.admin.transactions} />

      {/* Searching by pickup code works because the query is hashed with the same
          pepper before matching — support can find a transaction from a code read
          aloud, without the plaintext ever being stored. */}
      <form method="get" className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder={m.admin.searchPlaceholder}
          className="field-input"
          aria-label={m.common.search}
        />
        <select name="status" defaultValue={params.status ?? ''} className="field-input" aria-label={m.common.status}>
          <option value="">{m.common.all}</option>
          {TRANSACTION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
        <select
          name="riskLevel"
          defaultValue={params.riskLevel ?? ''}
          className="field-input"
          aria-label={m.admin.riskLevel}
        >
          <option value="">{m.common.all}</option>
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary px-6">
          {m.common.search}
        </button>
      </form>

      <Card>
        {results.length === 0 ? (
          <EmptyState title={m.admin.noResults} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-navy-100 bg-navy-50/50 text-left text-xs uppercase tracking-wide text-navy-400">
                <tr>
                  <th className="px-4 py-3 font-medium">{m.common.reference}</th>
                  <th className="px-4 py-3 font-medium">{m.auth.email}</th>
                  <th className="px-4 py-3 font-medium">{m.calculator.youReceive}</th>
                  <th className="px-4 py-3 font-medium">{m.calculator.total}</th>
                  <th className="px-4 py-3 font-medium">{m.common.status}</th>
                  <th className="px-4 py-3 font-medium">{m.admin.riskLevel}</th>
                  <th className="px-4 py-3 font-medium">{m.common.location}</th>
                  <th className="px-4 py-3 font-medium">{m.common.date}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {results.map((t) => (
                  <tr key={t.id} className="hover:bg-navy-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/transactions/${t.id}`}
                        className="font-mono text-xs font-medium text-larimar-700 hover:underline"
                      >
                        {t.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-navy-600">{t.user.email}</td>
                    <td className="tabular px-4 py-3 font-semibold text-navy-900">
                      {formatMoney(fromMinor(t.payoutAmountMinor, t.payoutCurrency), intl)}
                    </td>
                    <td className="tabular px-4 py-3 text-navy-600">
                      {formatMoney(fromMinor(t.totalChargedMinor, t.fundingCurrency), intl)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={t.status as TransactionStatus}
                        label={statusLabel(t.status)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={riskTone(t.riskLevel)}>
                        {t.riskLevel} · {t.riskScore}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-navy-500">
                      {t.pickupLocation ? `${t.pickupLocation.city}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-navy-400">{formatDate(t.createdAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
