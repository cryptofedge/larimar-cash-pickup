import Link from 'next/link';
import { getTranslations, formatDate } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { listCollectableTransactions, listTransactionsForUser, getActiveRiskPolicy } from '@/server/services/transaction';
import { getCurrentUser } from '@/server/services/auth';
import { prisma } from '@/server/db';
import { computeLimitUsage } from '@/lib/domain/risk';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES, interpolate } from '@/i18n/config';
import { Card, CardBody, CardHeader, EmptyState, StatusBadge, Alert } from '@/components/ui';
import { STATUS_MESSAGE_KEYS, type TransactionStatus } from '@/lib/domain/transaction-state';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const intl = INTL_LOCALES[locale];
  const money = (minor: bigint, currency: string) => formatMoney(fromMinor(minor, currency), intl);

  const statusLabel = (status: TransactionStatus): string => {
    const key = STATUS_MESSAGE_KEYS[status].split('.')[1] as keyof typeof m.status;
    return m.status[key];
  };

  const [user, collectable, recent, policy] = await Promise.all([
    getCurrentUser(principal.userId),
    listCollectableTransactions(principal.userId),
    listTransactionsForUser(principal.userId, { limit: 5 }),
    getActiveRiskPolicy('DO'),
  ]);

  const now = new Date();
  const [daily, monthly] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        userId: principal.userId,
        createdAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) },
        status: { in: ['PAYMENT_AUTHORIZED', 'COMPLIANCE_REVIEW', 'READY_FOR_PICKUP', 'PARTIALLY_PICKED_UP', 'PICKED_UP'] },
      },
      _sum: { totalChargedMinor: true },
    }),
    prisma.transaction.aggregate({
      where: {
        userId: principal.userId,
        createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
        status: { in: ['PAYMENT_AUTHORIZED', 'COMPLIANCE_REVIEW', 'READY_FOR_PICKUP', 'PARTIALLY_PICKED_UP', 'PICKED_UP'] },
      },
      _sum: { totalChargedMinor: true },
    }),
  ]);

  const limits = computeLimitUsage(
    daily._sum.totalChargedMinor ?? 0n,
    monthly._sum.totalChargedMinor ?? 0n,
    policy,
  );

  const kycApproved = (user?.identityVerifications.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy-900">
            {interpolate(m.dashboard.greeting, { name: user?.profile?.firstName ?? '' })}
          </h1>
          <p className="mt-1 text-navy-500">{m.brand.tagline}</p>
        </div>
        <Link href="/new" className="btn-primary">
          {m.dashboard.newPickup}
        </Link>
      </div>

      {!kycApproved ? (
        <Alert tone="info" title={m.dashboard.kycBannerTitle}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{m.dashboard.kycBannerBody}</span>
            <Link href="/verify-identity" className="btn-primary shrink-0 px-4 py-2 text-sm">
              {m.dashboard.kycBannerCta}
            </Link>
          </div>
        </Alert>
      ) : null}

      {/* ------------------------------------------------ Ready to collect */}
      <Card>
        <CardHeader title={m.dashboard.activeTitle} />
        {collectable.length === 0 ? (
          <EmptyState title={m.dashboard.activeEmpty} />
        ) : (
          <ul className="divide-y divide-navy-100">
            {collectable.map((transaction) => (
              <li key={transaction.id}>
                <Link
                  href={`/transactions/${transaction.id}`}
                  className="flex items-center justify-between gap-4 p-5 hover:bg-navy-50"
                >
                  <div className="min-w-0">
                    <p className="tabular text-lg font-bold text-navy-900">
                      {money(transaction.payoutAmountMinor, transaction.payoutCurrency)}
                    </p>
                    <p className="truncate text-sm text-navy-500">
                      {transaction.pickupLocation
                        ? `${transaction.pickupLocation.branchName}, ${transaction.pickupLocation.city}`
                        : m.common.notAvailable}
                    </p>
                    {transaction.pickupCode ? (
                      <p className="mt-0.5 text-xs text-navy-400">
                        {interpolate(m.pickup.expiresOn, {
                          date: formatDate(transaction.pickupCode.expiresAt, locale),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge
                    status={transaction.status as TransactionStatus}
                    label={statusLabel(transaction.status as TransactionStatus)}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* ------------------------------------------------------- Recent */}
        <Card>
          <CardHeader
            title={m.dashboard.recentTitle}
            action={
              <Link href="/transactions" className="text-sm font-medium text-larimar-700 hover:underline">
                {m.common.viewAll}
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              title={m.dashboard.recentEmpty}
              action={
                <Link href="/new" className="btn-primary">
                  {m.dashboard.newPickup}
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-navy-100">
              {recent.map((transaction) => (
                <li key={transaction.id}>
                  <Link
                    href={`/transactions/${transaction.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-navy-50"
                  >
                    <div className="min-w-0">
                      <p className="tabular font-semibold text-navy-900">
                        {money(transaction.payoutAmountMinor, transaction.payoutCurrency)}
                      </p>
                      <p className="text-xs text-navy-400">
                        {transaction.reference} · {formatDate(transaction.createdAt, locale)}
                      </p>
                    </div>
                    <StatusBadge
                      status={transaction.status as TransactionStatus}
                      label={statusLabel(transaction.status as TransactionStatus)}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ------------------------------------------------------- Limits */}
        <Card>
          <CardHeader title={m.dashboard.limitsTitle} />
          <CardBody className="space-y-5">
            <LimitBar
              label={interpolate(m.dashboard.dailyRemaining, {
                amount: money(limits.dailyRemainingMinor, limits.currency),
              })}
              used={limits.dailyUsedMinor}
              total={limits.dailyLimitMinor}
              caption={`${money(limits.dailyUsedMinor, limits.currency)} / ${money(limits.dailyLimitMinor, limits.currency)}`}
            />
            <LimitBar
              label={interpolate(m.dashboard.monthlyRemaining, {
                amount: money(limits.monthlyRemainingMinor, limits.currency),
              })}
              used={limits.monthlyUsedMinor}
              total={limits.monthlyLimitMinor}
              caption={`${money(limits.monthlyUsedMinor, limits.currency)} / ${money(limits.monthlyLimitMinor, limits.currency)}`}
            />
            <p className="text-xs leading-relaxed text-navy-400">{m.fees.demoNotice}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function LimitBar({
  label,
  used,
  total,
  caption,
}: {
  label: string;
  used: bigint;
  total: bigint;
  caption: string;
}) {
  const percent = total > 0n ? Math.min(100, Number((used * 100n) / total)) : 0;
  return (
    <div>
      <p className="text-sm font-medium text-navy-700">{label}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-navy-100">
        <div
          className={`h-full rounded-full ${percent > 85 ? 'bg-warning-500' : 'bg-larimar-500'}`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      <p className="tabular mt-1 text-xs text-navy-400">{caption}</p>
    </div>
  );
}
