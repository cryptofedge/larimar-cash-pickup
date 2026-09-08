import { getTranslations } from '@/i18n';
import { Card, CardBody } from '@/components/ui';
import { FAQ_CATEGORY_LABELS, FAQ_ITEMS, type FaqItem } from '@/content/faq';

export const metadata = { title: 'FAQ' };

export default async function FaqPage() {
  const { m, locale } = await getTranslations();
  const items = FAQ_ITEMS[locale];
  const labels = FAQ_CATEGORY_LABELS[locale];

  const categories: FaqItem['category'][] = ['general', 'pricing', 'pickup', 'security', 'compliance'];

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">
          {m.nav.faq}
        </h1>
        <p className="mt-3 text-lg text-navy-600">{m.support.helpSubtitle}</p>
      </div>

      <div className="mt-10 max-w-3xl space-y-10">
        {categories.map((category) => {
          const questions = items.filter((item) => item.category === category);
          if (questions.length === 0) return null;

          return (
            <section key={category}>
              <h2 className="mb-4 text-lg font-semibold text-navy-900">{labels[category]}</h2>
              <Card>
                <div className="divide-y divide-navy-100">
                  {questions.map((item) => (
                    <details key={item.question} className="group">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-medium text-navy-900 marker:hidden hover:bg-navy-50">
                        {item.question}
                        <span className="shrink-0 text-navy-300 transition-transform group-open:rotate-45">
                          +
                        </span>
                      </summary>
                      <div className="px-5 pb-5">
                        <p className="leading-relaxed text-navy-600">{item.answer}</p>
                      </div>
                    </details>
                  ))}
                </div>
              </Card>
            </section>
          );
        })}
      </div>

      <Card className="mt-10 max-w-3xl">
        <CardBody>
          <h2 className="font-semibold text-navy-900">{m.support.contactTitle}</h2>
          <p className="mt-1 text-navy-600">{m.support.contactSubtitle}</p>
          <a href="/contact" className="btn-primary mt-4">
            {m.support.contactTitle}
          </a>
        </CardBody>
      </Card>
    </div>
  );
}
