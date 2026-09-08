import Link from 'next/link';
import { getTranslations } from '@/i18n';
import { QuoteCalculator } from '@/components/transaction/QuoteCalculator';
import { Card, CardBody, DemoLocationBanner } from '@/components/ui';
import { listPickupLocations } from '@/server/services/pickup';
import { getActiveFeeSchedule } from '@/server/services/pricing';
import { formatBps } from '@/i18n';
import { FAQ_ITEMS } from '@/content/faq';

export default async function LandingPage() {
  const { m, locale } = await getTranslations();
  const [locations, schedule] = await Promise.all([
    listPickupLocations({ countryCode: 'DO', limit: 6 }),
    getActiveFeeSchedule('DO'),
  ]);

  const cities = [...new Set(locations.map((l) => l.city))];
  const faqs = FAQ_ITEMS[locale].slice(0, 4);

  return (
    <>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="border-b border-navy-100 bg-gradient-to-b from-larimar-50/70 to-white">
        <div className="container-page grid gap-10 py-12 lg:grid-cols-2 lg:items-center lg:py-20">
          <div className="animate-fade-up">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-navy-900 px-3 py-1 text-xs font-semibold text-larimar-200">
              {m.brand.tagline}
            </p>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-navy-900 sm:text-4xl lg:text-5xl">
              {m.home.heroTitle}
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-navy-600">
              {m.home.heroSubtitle}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/new" className="btn-primary text-lg">
                {m.home.ctaPrimary}
              </Link>
              <Link href="/how-it-works" className="btn-secondary text-lg">
                {m.home.ctaSecondary}
              </Link>
            </div>

            <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-navy-100 pt-6">
              <div>
                <dt className="text-xs text-navy-400">{m.nav.locations}</dt>
                <dd className="tabular text-2xl font-bold text-navy-900">{locations.length}+</dd>
              </div>
              <div>
                <dt className="text-xs text-navy-400">{m.calculator.platformFee}</dt>
                <dd className="tabular text-2xl font-bold text-navy-900">
                  {formatBps(schedule.platformFeeBps, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-navy-400">{m.calculator.exchangeRate}</dt>
                <dd className="text-2xl font-bold text-navy-900">USD → DOP</dd>
              </div>
            </dl>
          </div>

          <div className="lg:pl-6">
            <QuoteCalculator m={m} locale={locale} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- 3 steps */}
      <section className="container-page py-16" id="how">
        <h2 className="text-center text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
          {m.home.stepsTitle}
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            { n: 1, title: m.home.step1Title, body: m.home.step1Body },
            { n: 2, title: m.home.step2Title, body: m.home.step2Body },
            { n: 3, title: m.home.step3Title, body: m.home.step3Body },
          ].map((step) => (
            <Card key={step.n}>
              <CardBody>
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-navy-900 text-lg font-bold text-larimar-200">
                  {step.n}
                </div>
                <h3 className="text-lg font-semibold text-navy-900">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-navy-600">{step.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------------- Why us */}
      <section className="border-y border-navy-100 bg-navy-50/50 py-16">
        <div className="container-page">
          <h2 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            {m.home.whyTitle}
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {[
              { title: m.home.why1Title, body: m.home.why1Body },
              { title: m.home.why2Title, body: m.home.why2Body },
              { title: m.home.why3Title, body: m.home.why3Body },
              { title: m.home.why4Title, body: m.home.why4Body },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-navy-100 bg-white p-5">
                <h3 className="font-semibold text-navy-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Locations */}
      <section className="container-page py-16">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
              {m.home.locationsTitle}
            </h2>
            <p className="mt-1 text-navy-500">{m.home.locationsSubtitle}</p>
          </div>
          <Link href="/locations" className="btn-secondary">
            {m.common.viewAll}
          </Link>
        </div>

        <div className="mt-6">
          <div className="mb-4 flex flex-wrap gap-2">
            {cities.map((city) => (
              <span key={city} className="badge bg-navy-100 text-navy-700">
                {city}
              </span>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {locations.slice(0, 3).map((location) => (
              <Card key={location.id}>
                <CardBody className="space-y-3">
                  <div>
                    <p className="font-semibold text-navy-900">{location.branchName}</p>
                    <p className="text-sm text-navy-500">{location.institution.name}</p>
                    <p className="mt-1 text-sm text-navy-500">
                      {location.city}, {location.province}
                    </p>
                  </div>
                  {location.institution.isDemo ? (
                    <DemoLocationBanner label={m.pickup.demoLocationBanner} />
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ FAQ */}
      <section className="border-t border-navy-100 bg-navy-50/50 py-16">
        <div className="container-page max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            {m.home.faqTitle}
          </h2>
          <div className="mt-6 space-y-3">
            {faqs.map((item) => (
              <details key={item.question} className="group rounded-xl border border-navy-100 bg-white p-4">
                <summary className="cursor-pointer list-none font-medium text-navy-900 marker:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {item.question}
                    <span className="text-navy-300 transition-transform group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-navy-600">{item.answer}</p>
              </details>
            ))}
          </div>
          <div className="mt-6">
            <Link href="/faq" className="btn-secondary">
              {m.common.viewAll}
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- Trust */}
      <section className="container-page py-16">
        <Card className="border-warning-500/30 bg-warning-50">
          <CardBody>
            <h2 className="text-xl font-bold text-warning-700">{m.home.trustTitle}</h2>
            <p className="mt-3 max-w-3xl leading-relaxed text-warning-700/90">{m.home.trustBody}</p>
            <Link
              href="/trust"
              className="mt-4 inline-block font-semibold text-warning-700 underline underline-offset-4"
            >
              {m.home.trustLink} →
            </Link>
          </CardBody>
        </Card>
      </section>
    </>
  );
}
