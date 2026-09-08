import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, formatDate } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { getTransactionForUser, canCustomerCancel } from '@/server/services/transaction';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { formatRate } from '@/lib/domain/fx';
import { INTL_LOCALES, interpolate } from '@/i18n/config';
import {
  Alert,
  AmountRow,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DemoLocationBanner,
  StatusBadge,
} from '@/components/ui';
import { STATUS_MESSAGE_KEYS, type TransactionStatus } from '@/lib/domain/transaction-state';
import { CancelTransactionButton } from '@/components/transaction/CancelTransactionButton';

export const metadata = { title: 'Transaction' };
export const dynamic = 'force-dynamic';

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const { id } = await params;

  let transaction;
  try {
    transaction = await getTransactionForUser(id, principal.userId);
  } catch {
    notFound();
  }

  const intl = INTL_LOCALES[locale];
  const money = (minor: bigint, currency: string) => formatMoney(fromMinor(minor, currency), intl);
  const status = transaction.status as TransactionStatus;
  const statusKey = STATUS_MESSAGE_KEYS[status].split('.')[1] as keyof typeof m.status;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/transactions" className="text-sm text-larimar-700 hover:underline">
            ← {m.transaction.historyTitle}
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-900">
            {m.transaction.detailsTitle}
          </h1>
          <p className="mt-1 font-mono text-sm text-navy-400">{transaction.reference}</p>
        </div>
        <StatusBadge status={status} label={m.status[statusKey]} />
      </div>

      {/* The headline number, stated the way the customer thinks about it. */}
      <Card>
        <CardBody className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
            {m.calculator.youReceive}
          </p>
          <p className="amount-hero mt-1">
            {money(transaction.payoutAmountMinor, transaction.payoutCurrency)}
          </p>
          {transaction.paidOutMinor > 0n && transaction.paidOutMinor < transaction.payoutAmountMinor ? (
            <p className="tabular mt-2 text-sm text-navy-500">
              {money(transaction.paidOutMinor, transaction.payoutCurrency)} /{' '}
              {money(transaction.payoutAmountMinor, transaction.payoutCurrency)}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {status === 'READY_FOR_PICKUP' || status === 'PARTIALLY_PICKED_UP' ? (
        <Alert tone="success" title={m.status.readyForPickup}>
          {m.pickup.codeSubtitle}
          {transaction.pickupCode ? (
            <p className="mt-2 text-xs">
              {interpolate(m.pickup.expiresOn, {
                date: formatDate(transaction.pickupCode.expiresAt, locale),
              })}{' '}
              ·{' '}
              {interpolate(m.agent.attemptsRemaining, {
                count: String(transaction.pickupCode.maxAttempts - transaction.pickupCode.attemptCount),
              })}
            </p>
          ) : null}
          {/* The plaintext code is deliberately not shown again. */}
          <p className="mt-2 text-xs opacity-80">{m.security.codeBody}</p>
        </Alert>
      ) : null}

      {status === 'COMPLIANCE_REVIEW' ? (
        <Alert tone="warning" title={m.status.complianceReview}>
          {m.errors.complianceHold}
        </Alert>
      ) : null}

      {status === 'KYC_REQUIRED' ? (
        <Alert tone="info" title={m.dashboard.kycBannerTitle}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{m.dashboard.kycBannerBody}</span>
            <Link
              href={`/verify-identity?tx=${transaction.id}`}
              className="btn-primary shrink-0 px-4 py-2 text-sm"
            >
              {m.dashboard.kycBannerCta}
            </Link>
          </div>
        </Alert>
      ) : null}

      {/* --------------------------------------------------------- Receipt */}
      <Card>
        <CardHeader title={m.transaction.receipt} />
        <CardBody>
          <div className="divide-y divide-navy-100">
            <AmountRow
              label={m.calculator.exchangeRate}
              value={`1 ${transaction.fundingCurrency} = ${formatRate(transaction.effectiveRate, 4)} ${transaction.payoutCurrency}`}
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

          {transaction.payments[0]?.cardLast4 ? (
            <p className="mt-4 text-sm text-navy-500">
              {m.transaction.paymentMethod}: {transaction.payments[0].cardBrand} ••••{' '}
              {transaction.payments[0].cardLast4}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* -------------------------------------------------------- Location */}
      {transaction.pickupLocation ? (
        <Card>
          <CardHeader title={m.transaction.pickupLocation} />
          <CardBody className="space-y-3">
            <div>
              <p className="font-medium text-navy-900">{transaction.pickupLocation.branchName}</p>
              <p className="text-sm text-navy-500">
                {transaction.pickupLocation.institution.name}
              </p>
              <address className="mt-1 text-sm not-italic text-navy-500">
                {transaction.pickupLocation.addressLine1}
                <br />
                {transaction.pickupLocation.city}, {transaction.pickupLocation.province}
              </address>
            </div>
            {transaction.pickupLocation.institution.isDemo ? (
              <DemoLocationBanner
                label={m.pickup.demoLocationBanner}
                explanation={m.pickup.demoLocationExplain}
              />
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* -------------------------------------------------------- Timeline */}
      <Card>
        <CardHeader title={m.common.status} />
        <CardBody>
          <ol className="space-y-4">
            {transaction.events.map((event) => {
              const to = event.toStatus as TransactionStatus;
              const key = STATUS_MESSAGE_KEYS[to].split('.')[1] as keyof typeof m.status;
              return (
                <li key={event.id} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-larimar-500" />
                    <span className="mt-1 w-px flex-1 bg-navy-100" />
                  </div>
                  <div className="pb-1">
                    <p className="text-sm font-medium text-navy-900">{m.status[key]}</p>
                    {event.reason ? (
                      <p className="mt-0.5 text-sm text-navy-500">{event.reason}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-navy-400">
                      {formatDate(event.createdAt, locale, 'long')} · {event.actorType}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="neutral">{transaction.countryCode}</Badge>
        {canCustomerCancel(status) ? (
          <CancelTransactionButton
            transactionId={transaction.id}
            label={m.transaction.cancelTransaction}
            confirmLabel={m.transaction.cancelConfirm}
            errorLabel={m.errors.generic}
          />
        ) : null}
      </div>
    </div>
  );
}
