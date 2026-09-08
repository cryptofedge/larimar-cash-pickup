import { getTranslations } from '@/i18n';
import { Alert, Card, CardBody } from '@/components/ui';
import { ContactForm } from '@/components/support/ContactForm';

export const metadata = { title: 'Contact support' };

export default async function ContactPage() {
  const { m } = await getTranslations();

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">
          {m.support.contactTitle}
        </h1>
        <p className="mt-3 text-lg text-navy-600">{m.support.contactSubtitle}</p>
      </div>

      <div className="mt-8 grid max-w-4xl gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardBody>
            <ContactForm m={m} />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Alert tone="warning" title={m.legal.demoDisclaimerTitle}>
            {m.legal.demoDisclaimerBody}
          </Alert>
          <Card>
            <CardBody>
              <h2 className="font-semibold text-navy-900">{m.security.reportTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-navy-600">{m.security.reportBody}</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
