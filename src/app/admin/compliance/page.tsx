import { getTranslations, formatDate } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { hasPermission } from '@/server/auth/rbac';
import { listComplianceCases, listFraudAlerts, listPendingKyc } from '@/server/services/compliance';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES } from '@/i18n/config';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { ComplianceActions } from '@/components/admin/ComplianceActions';

export const metadata = { title: 'Compliance' };
export const dynamic = 'force-dynamic';

export default async function CompliancePage() {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const intl = INTL_LOCALES[locale];
  const [cases, pendingKyc, alerts] = await Promise.all([
    listComplianceCases(),
    listPendingKyc(),
    listFraudAlerts(),
  ]);

  // Only an analyst may act. A support agent or admin viewing this page sees the
  // queue but gets no buttons — and the API would refuse them anyway.
  const canAct = hasPermission(principal.roles, 'compliance.hold.release');

  const priorityTone = (priority: string) =>
    priority === 'CRITICAL' ? 'danger' : priority === 'HIGH' ? 'warning' : priority === 'MEDIUM' ? 'info' : 'neutral';

  return (
    <div className="space-y-6">
      <PageHeader
        title={m.admin.compliance}
        description={canAct ? undefined : m.errors.forbidden}
      />

      <Card>
        <CardHeader title={m.admin.complianceReviews} description={`${cases.length}`} />
        {cases.length === 0 ? (
          <EmptyState title={m.admin.noResults} />
        ) : (
          <ul className="divide-y divide-navy-100">
            {cases.map((complianceCase) => (
              <li key={complianceCase.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-navy-400">
                        {complianceCase.caseNumber}
                      </span>
                      <Badge tone={priorityTone(complianceCase.priority)}>
                        {complianceCase.priority}
                      </Badge>
                      <Badge tone="neutral">{complianceCase.type}</Badge>
                    </div>
                    <p className="mt-2 font-medium text-navy-900">{complianceCase.summary}</p>
                    <p className="mt-1 text-sm text-navy-500">
                      {complianceCase.subjectUser?.email ?? '—'}
                      {complianceCase.transaction ? (
                        <>
                          {' · '}
                          <span className="font-mono">{complianceCase.transaction.reference}</span>
                          {' · '}
                          <span className="tabular font-semibold text-navy-700">
                            {formatMoney(
                              fromMinor(
                                complianceCase.transaction.payoutAmountMinor,
                                complianceCase.transaction.payoutCurrency,
                              ),
                              intl,
                            )}
                          </span>
                          {' · '}
                          {m.admin.riskLevel}: {complianceCase.transaction.riskLevel} (
                          {complianceCase.transaction.riskScore})
                        </>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-navy-400">
                      {formatDate(complianceCase.openedAt, locale, 'long')}
                    </p>
                  </div>

                  {canAct && complianceCase.transaction ? (
                    <ComplianceActions
                      transactionId={complianceCase.transaction.id}
                      status={complianceCase.transaction.status}
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
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={m.admin.kycQueue} description={`${pendingKyc.length}`} />
          {pendingKyc.length === 0 ? (
            <EmptyState title={m.admin.noResults} />
          ) : (
            <ul className="divide-y divide-navy-100">
              {pendingKyc.map((verification) => (
                <li key={verification.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">
                      {verification.user.email}
                    </p>
                    <p className="text-xs text-navy-400">
                      {verification.documentType} · {verification.documentCountry} · ••••
                      {verification.documentLast4}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {verification.sanctionsHit ? <Badge tone="danger">Sanctions</Badge> : null}
                    {verification.pepHit ? <Badge tone="warning">PEP</Badge> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Fraud alerts" description={`${alerts.length}`} />
          {alerts.length === 0 ? (
            <EmptyState title={m.admin.noResults} />
          ) : (
            <ul className="divide-y divide-navy-100">
              {alerts.map((alert) => (
                <li key={alert.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-navy-900">{alert.type}</p>
                      <p className="mt-0.5 text-xs text-navy-500">{alert.description}</p>
                      {alert.transaction ? (
                        <p className="mt-0.5 font-mono text-xs text-navy-400">
                          {alert.transaction.reference}
                        </p>
                      ) : null}
                    </div>
                    <Badge tone={priorityTone(alert.severity)}>{alert.severity}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
