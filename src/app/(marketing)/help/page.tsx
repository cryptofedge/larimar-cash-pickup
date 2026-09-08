import Link from 'next/link';
import { getTranslations } from '@/i18n';
import { Card, CardBody } from '@/components/ui';
import { FAQ_CATEGORY_LABELS, FAQ_ITEMS } from '@/content/faq';

export const metadata = { title: 'Help center' };

export default async function HelpPage() {
  const { m, locale } = await getTranslations();
  const items = FAQ_ITEMS[locale];
  const labels = FAQ_CATEGORY_LABELS[locale];

  const topics = [
    { key: 'pickup' as const, href: '/faq#pickup' },
    { key: 'pricing' as const, href: '/fees' },
    { key: 'security' as const, href: '/security' },
    { key: 'compliance' as const, href: '/legal/aml' },
  ];

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">
          {m.support.helpTitle}
        </h1>
        <p className="mt-3 text-lg text-navy-600">{m.support.helpSubtitle}</p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {topics.map((topic) => (
          <Link key={topic.key} href={topic.href} className="card p-5 transition-shadow hover:shadow-lift">
            <p className="font-semibold text-navy-900">{labels[topic.key]}</p>
            <p className="mt-1 text-sm text-navy-500">
              {items.filter((i) => i.category === topic.key).length}{' '}
              {locale === 'es' ? 'artículos' : 'articles'}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-10 max-w-3xl">
        <h2 className="mb-4 text-lg font-semibold text-navy-900">{m.home.faqTitle}</h2>
        <Card>
          <div className="divide-y divide-navy-100">
            {items.slice(0, 8).map((item) => (
              <details key={item.question} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-medium text-navy-900 marker:hidden hover:bg-navy-50">
                  {item.question}
                  <span className="shrink-0 text-navy-300 transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="px-5 pb-5">
                  <p className="leading-relaxed text-navy-600">{item.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-8 max-w-3xl">
        <CardBody className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold text-navy-900">{m.support.contactTitle}</h2>
            <p className="mt-1 text-sm text-navy-600">{m.support.contactSubtitle}</p>
          </div>
          <Link href="/contact" className="btn-primary shrink-0">
            {m.support.contactTitle}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
