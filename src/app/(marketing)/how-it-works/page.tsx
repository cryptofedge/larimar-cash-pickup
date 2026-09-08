import Link from 'next/link';
import { getTranslations } from '@/i18n';
import { Card, CardBody, Alert } from '@/components/ui';
import { getCountry } from '@/lib/domain/countries';

export const metadata = { title: 'How it works' };

export default async function HowItWorksPage() {
  const { m, locale } = await getTranslations();
  const country = getCountry('DO');

  const steps = [
    {
      n: 1,
      title: m.home.step1Title,
      body: m.home.step1Body,
      detail:
        locale === 'es'
          ? 'Ingresas el monto en pesos que quieres recibir. Calculamos y mostramos la tasa, cada tarifa y el total exacto antes de que autorices nada. Los datos de tu tarjeta van directamente al proveedor de pagos.'
          : 'You enter the peso amount you want to receive. We calculate and show the rate, every fee, and the exact total before you authorize anything. Your card details go straight to the payment provider.',
    },
    {
      n: 2,
      title: m.home.step2Title,
      body: m.home.step2Body,
      detail:
        locale === 'es'
          ? 'En cuanto el pago se aprueba y se completan las verificaciones, se genera un código de retiro único. Se muestra una sola vez y también como código QR.'
          : 'As soon as payment clears and checks complete, a unique pickup code is generated. It is shown once, and also as a QR code.',
    },
    {
      n: 3,
      title: m.home.step3Title,
      body: m.home.step3Body,
      detail:
        locale === 'es'
          ? 'Presenta el código y tu identificación oficial. El agente verifica ambos contra el sistema antes de entregarte los pesos. La transacción se marca como completada.'
          : 'Present the code and your government-issued ID. The agent verifies both against the system before handing over the pesos. The transaction is marked completed.',
    },
  ];

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">
          {m.nav.howItWorks}
        </h1>
        <p className="mt-3 text-lg text-navy-600">{m.home.heroSubtitle}</p>
      </div>

      <div className="mt-10 space-y-6">
        {steps.map((step) => (
          <Card key={step.n}>
            <CardBody className="flex gap-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-lg font-bold text-larimar-200">
                {step.n}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-navy-900">{step.title}</h2>
                <p className="mt-1 text-navy-600">{step.body}</p>
                <p className="mt-3 text-sm leading-relaxed text-navy-500">{step.detail}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardBody>
            <h2 className="text-lg font-semibold text-navy-900">{m.pickup.bringId.replace('{documents}', '')}</h2>
            <ul className="mt-3 space-y-2 text-navy-600">
              {country.acceptedIdDocuments.map((doc) => (
                <li key={doc} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-larimar-500" />
                  {doc === 'PASSPORT'
                    ? m.kyc.passport
                    : doc === 'NATIONAL_ID'
                      ? m.kyc.nationalId
                      : doc === 'DRIVERS_LICENSE'
                        ? m.kyc.driversLicense
                        : m.kyc.residencePermit}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-navy-500">{m.pickup.securityWarning}</p>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="text-lg font-semibold text-navy-900">{m.transaction.expires}</h2>
            <p className="mt-2 text-navy-600">
              {locale === 'es'
                ? `Los códigos son válidos por ${country.pickupCodeTtlDays} días y permiten hasta ${country.pickupCodeMaxAttempts} intentos de verificación antes de bloquearse.`
                : `Codes are valid for ${country.pickupCodeTtlDays} days and allow up to ${country.pickupCodeMaxAttempts} verification attempts before locking.`}
            </p>
            <p className="mt-3 text-sm text-navy-500">
              {locale === 'es'
                ? 'Si un código vence sin ser cobrado, la transacción se reembolsa automáticamente.'
                : 'If a code expires uncollected, the transaction is automatically refunded.'}
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-10">
        <Alert tone="warning" title={m.legal.demoDisclaimerTitle}>
          {m.legal.demoDisclaimerBody}
        </Alert>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/new" className="btn-primary text-lg">
          {m.home.ctaPrimary}
        </Link>
        <Link href="/fees" className="btn-secondary text-lg">
          {m.nav.fees}
        </Link>
      </div>
    </div>
  );
}
