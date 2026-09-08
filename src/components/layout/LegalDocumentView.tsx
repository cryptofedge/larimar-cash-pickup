import { Alert } from '@/components/ui';
import type { LegalDocument } from '@/content/legal';
import type { Messages } from '@/i18n';
import { interpolate } from '@/i18n/config';

/** Shared renderer for the three legal documents. */
export function LegalDocumentView({
  document,
  m,
  updated,
}: {
  document: LegalDocument;
  m: Messages;
  updated: string;
}) {
  return (
    <div className="container-page py-12 lg:py-16">
      <article className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">
          {document.title}
        </h1>
        <p className="mt-2 text-sm text-navy-400">
          {interpolate(m.legal.lastUpdated, { date: updated })}
        </p>

        <div className="mt-6">
          <Alert tone="warning" title={m.legal.demoDisclaimerTitle}>
            {m.legal.demoDisclaimerBody}
          </Alert>
        </div>

        <p className="mt-6 leading-relaxed text-navy-600">{document.intro}</p>

        <div className="mt-8 space-y-8">
          {document.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold text-navy-900">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mt-2 leading-relaxed text-navy-600">
                  {paragraph}
                </p>
              ))}
              {section.bullets ? (
                <ul className="mt-3 space-y-2">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 text-navy-600">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-larimar-500" />
                      <span className="leading-relaxed">{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
