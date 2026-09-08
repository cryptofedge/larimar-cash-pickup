import { getTranslations } from '@/i18n';
import { Alert, Badge, Card, CardBody, DemoLocationBanner, EmptyState } from '@/components/ui';
import { listPickupLocations } from '@/server/services/pickup';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { INTL_LOCALES, interpolate } from '@/i18n/config';

export const metadata = { title: 'Pickup locations' };

interface OpeningHour {
  day: number;
  open?: string;
  close?: string;
  closed?: boolean;
}

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { m, locale } = await getTranslations();
  const params = await searchParams;
  const query = params.q?.trim();

  const locations = await listPickupLocations({
    countryCode: 'DO',
    query: query || undefined,
    activeOnly: false,
    limit: 200,
  });

  const intl = INTL_LOCALES[locale];
  const dayNames =
    locale === 'es'
      ? ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const byProvince = new Map<string, typeof locations>();
  for (const location of locations) {
    const list = byProvince.get(location.province) ?? [];
    list.push(location);
    byProvince.set(location.province, list);
  }

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">
          {m.pickup.locationsTitle}
        </h1>
        <p className="mt-3 text-lg text-navy-600">{m.pickup.locationsSubtitle}</p>
      </div>

      <div className="mt-8">
        <Alert tone="warning" title={m.pickup.demoLocationBanner}>
          {m.pickup.demoLocationExplain}
        </Alert>
      </div>

      {/* A plain GET form: works with JavaScript disabled and keeps the URL shareable. */}
      <form method="get" className="mt-6 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ''}
          placeholder={m.pickup.searchPlaceholder}
          className="field-input"
          aria-label={m.common.search}
        />
        <button type="submit" className="btn-primary px-6">
          {m.common.search}
        </button>
      </form>

      {locations.length === 0 ? (
        <Card className="mt-8">
          <EmptyState title={m.pickup.noResults} />
        </Card>
      ) : (
        <div className="mt-8 space-y-10">
          {[...byProvince.entries()].map(([province, list]) => (
            <section key={province}>
              <h2 className="mb-4 text-lg font-semibold text-navy-900">
                {province}
                <span className="ml-2 text-sm font-normal text-navy-400">({list.length})</span>
              </h2>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {list.map((location) => {
                  const hours = location.openingHours as unknown as OpeningHour[];
                  return (
                    <Card key={location.id}>
                      <CardBody className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-semibold text-navy-900">{location.branchName}</h3>
                            <p className="text-sm text-navy-500">{location.institution.name}</p>
                          </div>
                          <Badge tone={location.status === 'ACTIVE' ? 'success' : 'neutral'}>
                            {location.status === 'ACTIVE' ? m.pickup.openNow : m.pickup.closed}
                          </Badge>
                        </div>

                        <address className="text-sm not-italic text-navy-600">
                          {location.addressLine1}
                          <br />
                          {location.city}, {location.province}
                        </address>

                        <dl className="space-y-1 text-xs text-navy-500">
                          <div className="flex justify-between gap-2">
                            <dt>{m.pickup.maxPayout.replace(' {amount}', '')}</dt>
                            <dd className="tabular font-medium text-navy-700">
                              {formatMoney(fromMinor(location.maxPayoutMinor, 'DOP'), intl)}
                            </dd>
                          </div>
                          {location.contactPhone ? (
                            <div className="flex justify-between gap-2">
                              <dt>{m.common.actions}</dt>
                              <dd className="font-medium text-navy-700">{location.contactPhone}</dd>
                            </div>
                          ) : null}
                        </dl>

                        <details className="text-xs">
                          <summary className="cursor-pointer text-navy-500">
                            {locale === 'es' ? 'Horarios' : 'Opening hours'}
                          </summary>
                          <ul className="mt-2 space-y-0.5 text-navy-500">
                            {hours.map((hour) => (
                              <li key={hour.day} className="flex justify-between">
                                <span>{dayNames[hour.day]}</span>
                                <span className="tabular">
                                  {hour.closed ? m.pickup.closed : `${hour.open}–${hour.close}`}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>

                        {location.institution.isDemo ? (
                          <DemoLocationBanner label={m.pickup.demoLocationBanner} />
                        ) : null}

                        <a
                          href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=17/${location.latitude}/${location.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-sm font-medium text-larimar-700 underline underline-offset-4"
                        >
                          {m.pickup.getDirections} →
                        </a>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-10 text-sm text-navy-400">
        {interpolate(m.pickup.maxPayout, { amount: '' })}
      </p>
    </div>
  );
}
