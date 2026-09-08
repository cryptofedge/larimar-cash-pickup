import Link from 'next/link';
import { getTranslations } from '@/i18n';
import { Alert, Card, CardBody } from '@/components/ui';
import { getCountry } from '@/lib/domain/countries';

export const metadata = { title: 'Trust and compliance' };

/**
 * The page that states plainly what this is and is not.
 *
 * Written to be the opposite of reassuring boilerplate: it lists, by name, the
 * regulatory and commercial dependencies that would have to be satisfied before
 * a single real peso could change hands.
 */
export default async function TrustPage() {
  const { m, locale } = await getTranslations();
  const country = getCountry('DO');

  const doNotClaim =
    locale === 'es'
      ? [
          'No afirmamos estar autorizados, licenciados ni supervisados por ninguna autoridad.',
          'No afirmamos tener acuerdos con ningún banco o institución pagadora. No los tenemos.',
          'No afirmamos que nuestra tasa sea mejor que la de ningún competidor.',
          'No presentamos nuestras tasas de demostración como datos reales de mercado.',
          'No afirmamos haber verificado ningún documento de identidad.',
        ]
      : [
          'We do not claim to be authorized, licensed, or supervised by any authority.',
          'We do not claim agreements with any bank or payout institution. We have none.',
          'We do not claim our rate beats any competitor.',
          'We do not present our demonstration rates as real market data.',
          'We do not claim to have verified any identity document.',
        ];

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">
          {m.legal.complianceTitle}
        </h1>
        <p className="mt-3 text-lg text-navy-600">{m.home.trustBody}</p>
      </div>

      <div className="mt-8 max-w-3xl space-y-6">
        <Alert tone="danger" title={m.legal.demoDisclaimerTitle}>
          {m.legal.demoDisclaimerBody}
        </Alert>

        <Card>
          <CardBody>
            <h2 className="text-lg font-semibold text-navy-900">
              {locale === 'es' ? 'Lo que no afirmamos' : 'What we do not claim'}
            </h2>
            <ul className="mt-3 space-y-2">
              {doNotClaim.map((claim) => (
                <li key={claim} className="flex gap-3 text-navy-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger-500" />
                  <span className="leading-relaxed">{claim}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="text-lg font-semibold text-navy-900">
              {locale === 'es'
                ? 'Qué se requeriría antes de operar de verdad'
                : 'What would be required before operating for real'}
            </h2>
            <p className="mt-2 text-navy-600">
              {locale === 'es'
                ? 'Cada punto siguiente requiere revisión de asesores legales calificados en la República Dominicana. Esta lista es descriptiva, no es asesoría legal, y no afirma que una obligación específica aplique.'
                : 'Every point below requires review by qualified legal counsel in the Dominican Republic. This list is descriptive, is not legal advice, and does not assert that any particular obligation applies.'}
            </p>
            <ul className="mt-4 space-y-2">
              {country.regulatoryNotes.map((note) => (
                <li key={note} className="flex gap-3 text-sm text-navy-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-larimar-500" />
                  <span className="leading-relaxed">{note}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="text-lg font-semibold text-navy-900">
              {locale === 'es' ? 'Cómo tratamos tus datos aquí' : 'How your data is treated here'}
            </h2>
            <p className="mt-2 leading-relaxed text-navy-600">
              {locale === 'es'
                ? 'Este es un entorno de demostración. No envíes documentos de identidad reales, números de tarjeta reales ni contraseñas que uses en otros sitios. Los datos de tarjeta nunca llegan a este sistema por diseño, pero cualquier otra cosa que ingreses se guarda en una base de datos de demostración.'
                : 'This is a demonstration environment. Do not submit real identity documents, real card numbers, or passwords you use elsewhere. Card data never reaches this system by design, but anything else you enter is stored in a demonstration database.'}
            </p>
          </CardBody>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Link href="/legal/aml" className="btn-secondary">
            {m.legal.amlTitle}
          </Link>
          <Link href="/legal/terms" className="btn-secondary">
            {m.legal.termsTitle}
          </Link>
          <Link href="/legal/privacy" className="btn-secondary">
            {m.legal.privacyTitle}
          </Link>
        </div>
      </div>
    </div>
  );
}
