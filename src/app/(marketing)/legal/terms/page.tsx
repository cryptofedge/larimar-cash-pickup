import { getTranslations, formatDateOnly } from '@/i18n';
import { LEGAL_DOCUMENTS } from '@/content/legal';
import { LegalDocumentView } from '@/components/layout/LegalDocumentView';

export const metadata = { title: 'Terms of Service' };

export default async function TermsPage() {
  const { m, locale } = await getTranslations();
  return (
    <LegalDocumentView
      document={LEGAL_DOCUMENTS[locale].terms}
      m={m}
      updated={formatDateOnly(new Date('2026-01-01'), locale)}
    />
  );
}
