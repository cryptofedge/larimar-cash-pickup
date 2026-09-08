import { getTranslations, formatDateOnly } from '@/i18n';
import { LEGAL_DOCUMENTS } from '@/content/legal';
import { LegalDocumentView } from '@/components/layout/LegalDocumentView';

export const metadata = { title: 'Privacy Policy' };

export default async function PrivacyPage() {
  const { m, locale } = await getTranslations();
  return (
    <LegalDocumentView
      document={LEGAL_DOCUMENTS[locale].privacy}
      m={m}
      updated={formatDateOnly(new Date('2026-01-01'), locale)}
    />
  );
}
