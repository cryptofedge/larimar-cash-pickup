import { getTranslations, formatDate } from '@/i18n';
import { listAuditLog, listRecentPickupEvents } from '@/server/services/admin';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const { m, locale } = await getTranslations();
  const [entries, pickupEvents] = await Promise.all([listAuditLog(100), listRecentPickupEvents(25)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={m.admin.auditLog}
        description="Append-only. Secrets are redacted before write."
      />

      <Card>
        <CardHeader title={m.admin.auditLog} description={`${entries.length}`} />
        {entries.length === 0 ? (
          <EmptyState title={m.admin.noResults} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-navy-100 bg-navy-50/50 text-left text-xs uppercase tracking-wide text-navy-400">
                <tr>
                  <th className="px-4 py-3 font-medium">{m.common.date}</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Resource</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">{m.common.status}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-navy-50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-navy-500">
                      {formatDate(entry.createdAt, locale, 'long')}
                    </td>
                    <td className="px-4 py-2.5 text-navy-600">
                      {entry.actor?.email ?? entry.actorType}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-navy-800">{entry.action}</td>
                    <td className="px-4 py-2.5 text-xs text-navy-500">
                      {entry.resourceType}
                      {entry.resourceId ? (
                        <span className="ml-1 font-mono text-navy-400">
                          {entry.resourceId.slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-navy-400">{entry.ipAddress ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={entry.success ? 'success' : 'danger'}>
                        {entry.success ? 'OK' : 'DENIED'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Payout window events" description={`${pickupEvents.length}`} />
        {pickupEvents.length === 0 ? (
          <EmptyState title={m.admin.noResults} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-navy-100 bg-navy-50/50 text-left text-xs uppercase tracking-wide text-navy-400">
                <tr>
                  <th className="px-4 py-3 font-medium">{m.common.date}</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">{m.common.location}</th>
                  <th className="px-4 py-3 font-medium">{m.common.reference}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {pickupEvents.map((event) => (
                  <tr key={event.id} className="hover:bg-navy-50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-navy-500">
                      {formatDate(event.createdAt, locale, 'long')}
                    </td>
                    <td className="px-4 py-2.5">
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
                    </td>
                    <td className="px-4 py-2.5 text-navy-600">{event.agent?.email ?? '—'}</td>
                    <td className="px-4 py-2.5 text-navy-500">
                      {event.location ? `${event.location.branchName}, ${event.location.city}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-navy-400">
                      {event.transaction?.reference ?? '—'}
                    </td>
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
