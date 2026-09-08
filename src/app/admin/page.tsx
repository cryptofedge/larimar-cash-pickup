import { getTranslations } from '@/i18n';
import {
  getDashboardMetrics,
  getGeographicDistribution,
  getStatusDistribution,
  getVolumeSeries,
} from '@/server/services/admin';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES } from '@/i18n/config';
import { Alert, BarChart, Card, CardBody, CardHeader, ColumnChart, PageHeader, Stat } from '@/components/ui';
import { STATUS_MESSAGE_KEYS, type TransactionStatus } from '@/lib/domain/transaction-state';

export const metadata = { title: 'Admin overview' };
export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const { m, locale } = await getTranslations();
  const intl = INTL_LOCALES[locale];

  const [metrics, volume, statuses, geography] = await Promise.all([
    getDashboardMetrics(),
    getVolumeSeries(30),
    getStatusDistribution(),
    getGeographicDistribution(),
  ]);

  const money = (minor: bigint, currency: string) => formatMoney(fromMinor(minor, currency), intl);
  const statusLabel = (status: string): string => {
    const key = STATUS_MESSAGE_KEYS[status as TransactionStatus]?.split('.')[1] as
      | keyof typeof m.status
      | undefined;
    return key ? m.status[key] : status;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={m.admin.overview} />

      {/* The ledger invariant is the first thing an operator should see. */}
      {metrics.ledgerBalanced ? (
        <Alert tone="success" title={m.admin.ledgerIntegrity}>
          {m.admin.ledgerBalanced}
        </Alert>
      ) : (
        <Alert tone="danger" title={m.admin.ledgerIntegrity}>
          {m.admin.ledgerImbalanced}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={m.admin.totalTransactions} value={String(metrics.totalTransactions)} />
        <Stat
          label={m.admin.totalRequested}
          value={money(metrics.totalRequestedMinor, 'DOP')}
        />
        <Stat
          label={m.admin.totalPaidOut}
          value={money(metrics.totalPaidOutMinor, 'DOP')}
          tone="success"
        />
        <Stat label={m.admin.activeCustomers} value={String(metrics.activeCustomers)} />

        <Stat label={m.admin.pendingTransactions} value={String(metrics.pendingTransactions)} />
        <Stat
          label={m.admin.pendingKyc}
          value={String(metrics.pendingKyc)}
          tone={metrics.pendingKyc > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label={m.admin.complianceReviews}
          value={String(metrics.complianceReviews)}
          tone={metrics.complianceReviews > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label={m.admin.suspicious}
          value={String(metrics.suspiciousTransactions)}
          tone={metrics.suspiciousTransactions > 0 ? 'danger' : 'neutral'}
        />

        <Stat
          label={m.admin.failedPayments}
          value={String(metrics.failedPayments)}
          tone={metrics.failedPayments > 0 ? 'warning' : 'neutral'}
        />
        <Stat label={m.admin.refunds} value={String(metrics.refunds)} />
        <Stat
          label={m.admin.chargebacks}
          value={String(metrics.chargebacks)}
          tone={metrics.chargebacks > 0 ? 'danger' : 'neutral'}
        />
        <Stat label={m.admin.activeLocations} value={String(metrics.activeLocations)} />

        <Stat label={m.admin.dailyVolume} value={money(metrics.dailyVolumeMinor, 'USD')} />
        <Stat label={m.admin.monthlyVolume} value={money(metrics.monthlyVolumeMinor, 'USD')} />
        <Stat
          label={m.admin.volumeChart}
          value={money(metrics.totalFundedMinor, 'USD')}
          hint={m.calculator.youPay}
        />
        <Stat
          label="Fraud alerts"
          value={String(metrics.openFraudAlerts)}
          tone={metrics.openFraudAlerts > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={m.admin.volumeChart} description="30 days" />
          <CardBody>
            <ColumnChart
              data={volume.map((point) => ({ label: point.date, value: point.count }))}
              emptyLabel={m.admin.noResults}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={m.admin.payoutChart} description="30 days · DOP" />
          <CardBody>
            <ColumnChart
              data={volume.map((point) => ({
                label: point.date,
                value: Number(point.payoutMinor / 100n),
              }))}
              formatValue={(value) => formatMoney(fromMinor(BigInt(value) * 100n, 'DOP'), intl)}
              emptyLabel={m.admin.noResults}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={m.admin.statusChart} />
          <CardBody>
            <BarChart
              data={statuses.map((s) => ({ label: statusLabel(s.status), value: s.count }))}
              emptyLabel={m.admin.noResults}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={m.admin.geoChart} />
          <CardBody>
            <BarChart
              data={geography.map((g) => ({ label: `${g.city}`, value: g.count }))}
              emptyLabel={m.admin.noResults}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={m.admin.fundingChart} description="30 days · USD" />
        <CardBody>
          <ColumnChart
            data={volume.map((point) => ({
              label: point.date,
              value: Number(point.fundingMinor / 100n),
            }))}
            formatValue={(value) => formatMoney(fromMinor(BigInt(value) * 100n, 'USD'), intl)}
            emptyLabel={m.admin.noResults}
          />
        </CardBody>
      </Card>
    </div>
  );
}
