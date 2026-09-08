import { getTranslations } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { getCurrentUser } from '@/server/services/auth';
import { NewTransactionFlow } from '@/components/transaction/NewTransactionFlow';

export const metadata = { title: 'New cash pickup' };
export const dynamic = 'force-dynamic';

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ amount?: string }>;
}) {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const [{ amount }, user] = await Promise.all([searchParams, getCurrentUser(principal.userId)]);

  return (
    <div>
      <div className="mx-auto mb-6 max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{m.transaction.newTitle}</h1>
        <p className="mt-1 text-navy-500">{m.transaction.reviewSubtitle}</p>
      </div>

      <NewTransactionFlow
        m={m}
        locale={locale}
        initialAmount={amount}
        kycApproved={(user?.identityVerifications.length ?? 0) > 0}
      />
    </div>
  );
}
