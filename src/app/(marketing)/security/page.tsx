import { getTranslations } from '@/i18n';
import { Alert, Card, CardBody } from '@/components/ui';
import { CODE_ENTROPY_BITS, bruteForceKeyspace } from '@/lib/domain/pickup-code';

export const metadata = { title: 'Security' };

export default async function SecurityPage() {
  const { m, locale } = await getTranslations();
  const keyspace = bruteForceKeyspace().toLocaleString(locale === 'es' ? 'es-DO' : 'en-US');

  const sections = [
    { title: m.security.cardDataTitle, body: m.security.cardDataBody },
    { title: m.security.codeTitle, body: m.security.codeBody },
    { title: m.security.identityTitle, body: m.security.identityBody },
    { title: m.security.accountTitle, body: m.security.accountBody },
  ];

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">
          {m.security.title}
        </h1>
        <p className="mt-3 text-lg text-navy-600">{m.security.subtitle}</p>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardBody>
              <h2 className="text-lg font-semibold text-navy-900">{section.title}</h2>
              <p className="mt-2 leading-relaxed text-navy-600">{section.body}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardBody>
          <h2 className="text-lg font-semibold text-navy-900">
            {locale === 'es' ? 'Las cifras detrás del código' : 'The numbers behind the code'}
          </h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-navy-50 p-4">
              <dt className="text-xs uppercase tracking-wide text-navy-400">
                {locale === 'es' ? 'Entropía' : 'Entropy'}
              </dt>
              <dd className="tabular mt-1 text-2xl font-bold text-navy-900">
                {CODE_ENTROPY_BITS} {locale === 'es' ? 'bits' : 'bits'}
              </dd>
            </div>
            <div className="rounded-xl bg-navy-50 p-4">
              <dt className="text-xs uppercase tracking-wide text-navy-400">
                {locale === 'es' ? 'Combinaciones' : 'Combinations'}
              </dt>
              <dd className="tabular mt-1 text-2xl font-bold text-navy-900">{keyspace}</dd>
            </div>
            <div className="rounded-xl bg-navy-50 p-4">
              <dt className="text-xs uppercase tracking-wide text-navy-400">
                {locale === 'es' ? 'Intentos permitidos' : 'Attempts allowed'}
              </dt>
              <dd className="tabular mt-1 text-2xl font-bold text-navy-900">5</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-navy-500">
            {locale === 'es'
              ? 'Un código de retiro es un instrumento al portador, así que se trata como tal: se genera con aleatoriedad criptográfica, se guarda solo como hash con una clave secreta que no está en la base de datos, se limita a unos pocos intentos y siempre se combina con una verificación de identidad física.'
              : 'A pickup code is a bearer instrument, so it is treated as one: generated with cryptographic randomness, stored only as a hash keyed with a secret that is not in the database, limited to a handful of attempts, and always paired with a physical identity check.'}
          </p>
        </CardBody>
      </Card>

      <div className="mt-6">
        <Alert tone="info" title={m.security.reportTitle}>
          {m.security.reportBody}
        </Alert>
      </div>

      <div className="mt-6">
        <Alert tone="warning" title={m.legal.demoDisclaimerTitle}>
          {m.legal.demoDisclaimerBody}
        </Alert>
      </div>
    </div>
  );
}
