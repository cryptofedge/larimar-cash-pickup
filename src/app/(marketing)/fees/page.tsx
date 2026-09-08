import { getTranslations, formatBps } from '@/i18n';
import { Alert, Card, CardBody, AmountRow } from '@/components/ui';
import { QuoteCalculator } from '@/components/transaction/QuoteCalculator';
import { getActiveFeeSchedule } from '@/server/services/pricing';
import { priceQuote } from '@/server/services/pricing';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES, interpolate } from '@/i18n/config';

export const metadata = { title: 'Fees' };

export default async function FeesPage() {
  const { m, locale } = await getTranslations();
  const schedule = await getActiveFeeSchedule('DO');
  const intl = INTL_LOCALES[locale];

  // A live worked example, priced by the same engine that prices real quotes —
  // so this page can never drift from what a customer is actually charged.
  const example = await priceQuote({
    payoutAmountMinor: 2_000_000n,
    payoutCurrency: 'DOP',
    fundingCurrency: 'USD',
    countryCode: 'DO',
  });
  const b = example.breakdown;
  const money = (minor: bigint, currency: string) => formatMoney(fromMinor(minor, currency), intl);

  const items = [
    {
      title: m.fees.platformFeeTitle,
      body: interpolate(m.fees.platformFeeBody, {
        percent: formatBps(schedule.platformFeeBps, locale),
        minimum: money(schedule.platformFeeMinMinor, schedule.feeCurrency),
      }),
    },
    {
      title: m.fees.processingFeeTitle,
      body: interpolate(m.fees.processingFeeBody, {
        percent: formatBps(schedule.processingFeeBps, locale),
        fixed: money(schedule.processingFeeFixedMinor, schedule.feeCurrency),
      }),
    },
    {
      title: m.fees.fxSpreadTitle,
      body: interpolate(m.fees.fxSpreadBody, {
        percent: formatBps(schedule.fxSpreadBps, locale),
      }),
    },
    {
      title: m.fees.expeditedTitle,
      body: interpolate(m.fees.expeditedBody, {
        amount: money(schedule.expeditedFeeMinor, schedule.feeCurrency),
      }),
    },
  ];

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">
          {m.fees.title}
        </h1>
        <p className="mt-3 text-lg text-navy-600">{m.fees.subtitle}</p>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          {items.map((item) => (
            <Card key={item.title}>
              <CardBody>
                <h2 className="font-semibold text-navy-900">{item.title}</h2>
                <p className="mt-1.5 leading-relaxed text-navy-600">{item.body}</p>
              </CardBody>
            </Card>
          ))}

          <Card className="border-larimar-200 bg-larimar-50">
            <CardBody>
              <h2 className="font-semibold text-larimar-900">{m.fees.noHiddenTitle}</h2>
              <p className="mt-1.5 leading-relaxed text-larimar-800">{m.fees.noHiddenBody}</p>
            </CardBody>
          </Card>

          <Alert tone="warning">{m.fees.demoNotice}</Alert>
        </div>

        <div className="space-y-6">
          <Card>
            <CardBody>
              <h2 className="mb-3 font-semibold text-navy-900">{m.fees.exampleTitle}</h2>
              <div className="divide-y divide-navy-100">
                <AmountRow
                  label={m.calculator.youReceive}
                  value={money(b.payoutAmount.amount, b.payoutAmount.currency)}
                />
                <AmountRow
                  label={m.calculator.exchangeRate}
                  value={`1 USD = ${(Number(b.effectiveRate) / 1e8).toFixed(4)} DOP`}
                />
                <AmountRow
                  label={m.calculator.youPay}
                  value={money(b.principal.amount, b.principal.currency)}
                />
                <AmountRow
                  label={m.calculator.platformFee}
                  value={money(b.platformFee.amount, b.platformFee.currency)}
                />
                <AmountRow
                  label={m.calculator.processingFee}
                  value={money(b.processingFee.amount, b.processingFee.currency)}
                />
                <AmountRow
                  label={m.calculator.fxSpread}
                  value={money(b.fxSpreadCost.amount, b.fxSpreadCost.currency)}
                  muted
                />
                <AmountRow
                  label={m.calculator.total}
                  value={money(b.totalCharged.amount, b.totalCharged.currency)}
                  emphasis
                />
              </div>
            </CardBody>
          </Card>

          <QuoteCalculator m={m} locale={locale} compact />
        </div>
      </div>
    </div>
  );
}
