import { getTranslations } from '@/i18n';
import { listPickupLocations } from '@/server/services/pickup';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES } from '@/i18n/config';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: 'Locations' };
export const dynamic = 'force-dynamic';

export default async function AdminLocationsPage() {
  const { m, locale } = await getTranslations();
  const intl = INTL_LOCALES[locale];

  const locations = await listPickupLocations({ activeOnly: false, limit: 200 });

  const statusTone = (status: string) =>
    status === 'ACTIVE' ? 'success' : status === 'SUSPENDED' ? 'danger' : 'neutral';

  return (
    <div className="space-y-6">
      <PageHeader title={m.admin.locations} description={`${locations.length}`} />

      <Alert tone="warning" title={m.pickup.demoLocationBanner}>
        {m.pickup.demoLocationExplain}
      </Alert>

      <Card>
        {locations.length === 0 ? (
          <EmptyState title={m.admin.noResults} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-navy-100 bg-navy-50/50 text-left text-xs uppercase tracking-wide text-navy-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 font-medium">Institution</th>
                  <th className="px-4 py-3 font-medium">{m.common.location}</th>
                  <th className="px-4 py-3 font-medium">Max payout</th>
                  <th className="px-4 py-3 font-medium">Daily capacity</th>
                  <th className="px-4 py-3 font-medium">Used today</th>
                  <th className="px-4 py-3 font-medium">Risk tier</th>
                  <th className="px-4 py-3 font-medium">{m.common.status}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {locations.map((location) => (
                  <tr key={location.id} className="hover:bg-navy-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-navy-500">{location.code}</td>
                    <td className="px-4 py-2.5 font-medium text-navy-900">{location.branchName}</td>
                    <td className="px-4 py-2.5 text-navy-600">
                      {location.institution.name}
                      {location.institution.isDemo ? (
                        <Badge tone="warning" className="ml-2">
                          DEMO
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-navy-500">
                      {location.city}, {location.province}
                    </td>
                    <td className="tabular px-4 py-2.5 text-navy-700">
                      {formatMoney(fromMinor(location.maxPayoutMinor, 'DOP'), intl)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-navy-700">
                      {formatMoney(fromMinor(location.dailyCapacityMinor, 'DOP'), intl)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-navy-500">
                      {formatMoney(fromMinor(location.dailyUsedMinor, 'DOP'), intl)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={location.riskTier >= 2 ? 'warning' : 'neutral'}>
                        {location.riskTier}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(location.status)}>{location.status}</Badge>
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
