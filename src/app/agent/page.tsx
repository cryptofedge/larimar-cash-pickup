import { getTranslations, formatDate } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { PayoutTerminal } from '@/components/agent/PayoutTerminal';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES } from '@/i18n/config';

export const metadata = { title: 'Payout portal' };
export const dynamic = 'force-dynamic';

export default async function AgentPortalPage() {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const intl = INTL_LOCALES[locale];

  // Only the locations this agent is actually assigned to. The API enforces the
  // same restriction independently — this just avoids offering an invalid choice.
  const assignments = await prisma.agentLocationAssignment.findMany({
    where: { userId: principal.userId, active: true },
    select: { location: { select: { id: true, branchName: true, city: true } } },
  });

  const locations = assignments.map((a) => a.location);

  const recent = await prisma.pickupEvent.findMany({
    where: { agentId: principal.userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      eventType: true,
      amountMinor: true,
      currency: true,
      createdAt: true,
      transaction: { select: { reference: true } },
    },
  });

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{m.agent.portalTitle}</h1>
        <p className="mt-1 text-navy-500">{m.agent.portalSubtitle}</p>
      </div>

      {locations.length === 0 ? (
        <Card>
          <EmptyState
            title={m.agent.wrongLocation}
            description={
              locale === 'es'
                ? 'Tu cuenta no tiene ubicaciones asignadas. Contacta a tu supervisor.'
                : 'Your account has no assigned locations. Contact your supervisor.'
            }
          />
        </Card>
      ) : (
        <PayoutTerminal m={m} locale={locale} locations={locations} />
      )}

      <div className="mx-auto max-w-lg">
        <Card>
          <CardHeader title={m.transaction.historyTitle} />
          {recent.length === 0 ? (
            <EmptyState title={m.transaction.historyEmpty} />
          ) : (
            <ul className="divide-y divide-navy-100">
              {recent.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-navy-800">{event.eventType}</p>
                    <p className="truncate font-mono text-xs text-navy-400">
                      {event.transaction?.reference ?? '—'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {event.amountMinor && event.currency ? (
                      <p className="tabular font-semibold text-navy-900">
                        {formatMoney(fromMinor(event.amountMinor, event.currency), intl)}
                      </p>
                    ) : null}
                    <p className="text-xs text-navy-400">{formatDate(event.createdAt, locale)}</p>
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
