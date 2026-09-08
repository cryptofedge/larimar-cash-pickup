import { getTranslations, formatDate } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { hasPermission } from '@/server/auth/rbac';
import { prisma } from '@/server/db';
import {
  getFloatStatus,
  getOutstandingExposure,
  listSettlementBatches,
} from '@/server/services/settlement';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES } from '@/i18n/config';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui';
import {
  GenerateSettlementButton,
  SettlementActions,
} from '@/components/admin/SettlementActions';

export const metadata = { title: 'Settlement' };
export const dynamic = 'force-dynamic';

export default async function SettlementPage() {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const intl = INTL_LOCALES[locale];
  const money = (minor: bigint, currency: string) => formatMoney(fromMinor(minor, currency), intl);

  const [batches, exposure, float, institutions] = await Promise.all([
    listSettlementBatches({ limit: 50 }),
    getOutstandingExposure(),
    getFloatStatus(),
    prisma.pickupInstitution.findMany({
      where: { active: true, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const canGenerate = hasPermission(principal.roles, 'settlement.generate');
  const canReconcile = hasPermission(principal.roles, 'settlement.reconcile');
  const canPay = hasPermission(principal.roles, 'settlement.pay');

  const totalExposure = exposure.reduce((sum, e) => sum + e.outstandingMinor, 0n);
  const unpaid = batches.filter((b) => b.status !== 'PAID' && b.status !== 'CANCELLED');
  const disputed = batches.filter((b) => b.status === 'DISPUTED');

  const statusTone = (status: string) =>
    status === 'PAID'
      ? 'success'
      : status === 'DISPUTED'
        ? 'danger'
        : status === 'RECONCILED'
          ? 'info'
          : status === 'CANCELLED'
            ? 'neutral'
            : 'warning';

  const floatTone = (level: string) =>
    level === 'EXHAUSTED' || level === 'CRITICAL'
      ? 'danger'
      : level === 'WATCH'
        ? 'warning'
        : 'success';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlement"
        description="What the platform owes payout partners for cash they fronted."
        action={canGenerate ? <GenerateSettlementButton institutions={institutions} /> : undefined}
      />

      <Alert tone="warning" title={m.legal.demoDisclaimerTitle}>
        No funds are transferred. Marking a batch paid records the intent and posts the
        ledger entry; there is no payment rail behind it.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Unsettled exposure"
          value={money(totalExposure, 'DOP')}
          hint="Cash fronted, not yet repaid"
          tone={totalExposure > 0n ? 'warning' : 'neutral'}
        />
        <Stat label="Open batches" value={String(unpaid.length)} />
        <Stat
          label="Disputed"
          value={String(disputed.length)}
          tone={disputed.length > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          label="Locations at float risk"
          value={String(float.filter((f) => f.level !== 'OK').length)}
          tone={float.some((f) => f.level === 'EXHAUSTED' || f.level === 'CRITICAL') ? 'danger' : 'neutral'}
        />
      </div>

      {/* ------------------------------------------------------------ batches */}
      <Card>
        <CardHeader title="Settlement batches" description={`${batches.length}`} />
        {batches.length === 0 ? (
          <EmptyState
            title="No settlement batches yet"
            description="Generate one for a period in which payouts were disbursed."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-navy-100 bg-navy-50/50 text-left text-xs uppercase tracking-wide text-navy-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Batch</th>
                  <th className="px-4 py-3 font-medium">Partner</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Payouts</th>
                  <th className="px-4 py-3 font-medium">Gross</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Net payable</th>
                  <th className="px-4 py-3 font-medium">Variance</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">{m.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-navy-50">
                    <td className="px-4 py-3 font-mono text-xs text-navy-700">{batch.reference}</td>
                    <td className="px-4 py-3 text-navy-600">
                      {batch.institution.name}
                      {batch.institution.isDemo ? (
                        <Badge tone="warning" className="ml-2">
                          DEMO
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-navy-500">
                      {formatDate(batch.periodStart, locale)}
                    </td>
                    <td className="tabular px-4 py-3 text-navy-700">{batch.payoutCount}</td>
                    <td className="tabular px-4 py-3 text-navy-900">
                      {money(batch.grossPayoutMinor, batch.currency)}
                    </td>
                    <td className="tabular px-4 py-3 text-navy-500">
                      {money(batch.commissionMinor, batch.currency)}
                      <span className="ml-1 text-xs text-navy-400">
                        ({(batch.commissionBps / 100).toFixed(2)}%)
                      </span>
                    </td>
                    <td className="tabular px-4 py-3 font-semibold text-navy-900">
                      {money(batch.netPayableMinor, batch.currency)}
                    </td>
                    <td className="tabular px-4 py-3">
                      {batch.varianceMinor === null ? (
                        <span className="text-navy-300">—</span>
                      ) : batch.varianceMinor === 0n ? (
                        <span className="text-success-700">match</span>
                      ) : (
                        <span className="font-semibold text-danger-600">
                          {money(batch.varianceMinor, batch.currency)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(batch.status)}>{batch.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <SettlementActions
                        batchId={batch.id}
                        status={batch.status}
                        grossPayoutMinor={batch.grossPayoutMinor.toString()}
                        canGenerate={canGenerate}
                        canReconcile={canReconcile}
                        canPay={canPay}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --------------------------------------------------------- exposure */}
        <Card>
          <CardHeader
            title="Unsettled exposure by partner"
            description="Disbursed cash not yet included in a paid batch"
          />
          {exposure.length === 0 ? (
            <EmptyState title={m.admin.noResults} />
          ) : (
            <ul className="divide-y divide-navy-100">
              {exposure.map((entry) => (
                <li
                  key={entry.institutionId}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">
                      {entry.institutionName}
                    </p>
                    <p className="text-xs text-navy-400">{entry.payoutCount} payouts</p>
                  </div>
                  <span className="tabular font-semibold text-navy-900">
                    {money(entry.outstandingMinor, entry.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ------------------------------------------------------------ float */}
        <Card>
          <CardHeader
            title="Float pressure"
            description="Predicts a customer being turned away at a window"
          />
          {float.length === 0 ? (
            <EmptyState title={m.admin.noResults} />
          ) : (
            <ul className="divide-y divide-navy-100">
              {float.slice(0, 10).map((location) => (
                <li key={location.locationId} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy-900">
                        {location.branchName}
                      </p>
                      <p className="text-xs text-navy-400">{location.city}</p>
                    </div>
                    <Badge tone={floatTone(location.level)}>{location.level}</Badge>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-100">
                    <div
                      className={`h-full rounded-full ${
                        location.level === 'OK'
                          ? 'bg-larimar-500'
                          : location.level === 'WATCH'
                            ? 'bg-warning-500'
                            : 'bg-danger-500'
                      }`}
                      style={{ width: `${Math.max(2, Math.min(100, location.utilisationPercent))}%` }}
                    />
                  </div>
                  <p className="tabular mt-1 text-xs text-navy-400">
                    {money(location.usedMinor, 'DOP')} / {money(location.capacityMinor, 'DOP')} (
                    {location.utilisationPercent}%)
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
