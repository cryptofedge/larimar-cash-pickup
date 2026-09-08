import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, formatDate } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { hasPermission } from '@/server/auth/rbac';
import { prisma } from '@/server/db';
import { getLedgerEntriesForTransaction } from '@/server/services/ledger';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { formatRate } from '@/lib/domain/fx';
import { INTL_LOCALES } from '@/i18n/config';
import { AmountRow, Badge, Card, CardBody, CardHeader, StatusBadge } from '@/components/ui';
import { STATUS_MESSAGE_KEYS, type TransactionStatus } from '@/lib/domain/transaction-state';
import { ComplianceActions } from '@/components/admin/ComplianceActions';

export const metadata = { title: 'Transaction detail' };
export const dynamic = 'force-dynamic';

export default async function AdminTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const { id } = await params;
  const intl = INTL_LOCALES[locale];

  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, createdAt: true } },
      quote: true,
      pickupLocation: { include: { institution: true } },
      payments: { orderBy: { createdAt: 'desc' } },
      events: { orderBy: { createdAt: 'asc' } },
      pickupCode: true,
      riskEvents: { orderBy: { createdAt: 'desc' } },
      complianceCases: { orderBy: { openedAt: 'desc' } },
      pickupEvents: {
        orderBy: { createdAt: 'desc' },
        include: { agent: { select: { email: true } }, location: { select: { branchName: true } } },
      },
      refunds: true,
      chargebacks: true,
    },
  });

  if (!transaction) notFound();

  const canSeeLedger = hasPermission(principal.roles, 'ledger.read');
  const ledger = canSeeLedger ? await getLedgerEntriesForTransaction(id) : [];
  const canAct = hasPermission(principal.roles, 'compliance.hold.place');

  const money = (minor: bigint, currency: string) => formatMoney(fromMinor(minor, currency), intl);
  const status = transaction.status as TransactionStatus;
  const statusKey = STATUS_MESSAGE_KEYS[status].split('.')[1] as keyof typeof m.status;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/transactions" className="text-sm text-larimar-700 hover:underline">
            ← {m.admin.transactions}
          </Link>
          <h1 className="mt-2 font-mono text-xl font-bold text-navy-900">{transaction.reference}</h1>
          <p className="mt-1 text-sm text-navy-500">
            {transaction.user.email} · {formatDate(transaction.createdAt, locale, 'long')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} label={m.status[statusKey]} />
          <Badge
            tone={
              transaction.riskLevel === 'CRITICAL'
                ? 'danger'
                : transaction.riskLevel === 'HIGH'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {transaction.riskLevel} · {transaction.riskScore}
          </Badge>
          {canAct ? (
            <ComplianceActions
              transactionId={transaction.id}
              status={transaction.status}
              labels={{
                release: m.admin.releaseHold,
                reject: m.agent.rejectPickup,
                hold: m.admin.placeHold,
                reason: m.agent.escalateReason,
                error: m.errors.generic,
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={m.transaction.receipt} />
          <CardBody>
            <div className="divide-y divide-navy-100">
              <AmountRow
                label={m.calculator.youReceive}
                value={money(transaction.payoutAmountMinor, transaction.payoutCurrency)}
                emphasis
              />
              <AmountRow
                label="Paid out"
                value={money(transaction.paidOutMinor, transaction.payoutCurrency)}
              />
              <AmountRow
                label={m.calculator.exchangeRate}
                value={`1 ${transaction.fundingCurrency} = ${formatRate(transaction.effectiveRate, 6)}`}
              />
              <AmountRow
                label={m.calculator.youPay}
                value={money(transaction.quote.principalMinor, transaction.fundingCurrency)}
              />
              <AmountRow
                label={m.calculator.platformFee}
                value={money(transaction.platformFeeMinor, transaction.fundingCurrency)}
              />
              <AmountRow
                label={m.calculator.processingFee}
                value={money(transaction.processingFeeMinor, transaction.fundingCurrency)}
              />
              <AmountRow
                label={m.calculator.total}
                value={money(transaction.totalChargedMinor, transaction.fundingCurrency)}
                emphasis
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={m.admin.riskLevel} />
          <CardBody>
            {transaction.riskEvents.length === 0 ? (
              <p className="text-sm text-navy-400">{m.admin.noResults}</p>
            ) : (
              <ul className="space-y-2">
                {transaction.riskEvents.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <p className="font-mono text-xs text-navy-700">{event.ruleKey}</p>
                      <p className="text-xs text-navy-500">{event.detail}</p>
                    </div>
                    <Badge
                      tone={
                        event.level === 'CRITICAL'
                          ? 'danger'
                          : event.level === 'HIGH'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      +{event.score}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={m.common.status} />
          <CardBody>
            <ol className="space-y-3">
              {transaction.events.map((event) => (
                <li key={event.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-larimar-500" />
                  <div>
                    <p className="font-medium text-navy-800">
                      {event.fromStatus ?? '—'} → {event.toStatus}
                    </p>
                    {event.reason ? <p className="text-xs text-navy-500">{event.reason}</p> : null}
                    <p className="text-xs text-navy-400">
                      {formatDate(event.createdAt, locale, 'long')} · {event.actorType}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payout window events" />
          <CardBody>
            {transaction.pickupEvents.length === 0 ? (
              <p className="text-sm text-navy-400">{m.admin.noResults}</p>
            ) : (
              <ul className="space-y-2">
                {transaction.pickupEvents.map((event) => (
                  <li key={event.id} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <Badge
                        tone={
                          event.eventType.includes('FAILED') || event.eventType.includes('LOCKED')
                            ? 'danger'
                            : event.eventType.includes('COMPLETED')
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {event.eventType}
                      </Badge>
                      <span className="text-xs text-navy-400">
                        {formatDate(event.createdAt, locale)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-navy-500">
                      {event.agent?.email ?? '—'} · {event.location?.branchName ?? '—'}
                      {event.documentLast4 ? ` · ••••${event.documentLast4}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {canSeeLedger ? (
        <Card>
          <CardHeader title={m.admin.ledger} />
          <CardBody>
            {ledger.length === 0 ? (
              <p className="text-sm text-navy-400">{m.admin.noResults}</p>
            ) : (
              <div className="space-y-4">
                {ledger.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-navy-100 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Badge tone="neutral">{entry.eventType}</Badge>
                      <span className="text-xs text-navy-400">{entry.description}</span>
                    </div>
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {entry.entries.map((line) => (
                          <tr key={line.id}>
                            <td className="py-0.5 pr-3 font-mono text-navy-500">
                              {line.account.code}
                            </td>
                            <td className="py-0.5 pr-3 text-navy-500">{line.direction}</td>
                            <td className="tabular py-0.5 text-right font-medium text-navy-900">
                              {formatMoney(fromMinor(line.amountMinor, line.currency), intl)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
