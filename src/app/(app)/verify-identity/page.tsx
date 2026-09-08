import { getTranslations } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { getCurrentUser } from '@/server/services/auth';
import { Alert, Card, CardBody } from '@/components/ui';
import { KycForm } from '@/components/kyc/KycForm';

export const metadata = { title: 'Verify identity' };
export const dynamic = 'force-dynamic';

export default async function VerifyIdentityPage({
  searchParams,
}: {
  searchParams: Promise<{ tx?: string }>;
}) {
  const { m } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const [{ tx }, user] = await Promise.all([searchParams, getCurrentUser(principal.userId)]);
  const alreadyVerified = (user?.identityVerifications.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{m.kyc.title}</h1>
        <p className="mt-1 text-navy-500">{m.kyc.subtitle}</p>
      </div>

      {alreadyVerified ? (
        <Alert tone="success" title={m.kyc.approvedTitle}>
          {m.kyc.subtitle}
        </Alert>
      ) : (
        <>
          <Alert tone="warning">{m.kyc.demoNotice}</Alert>
          <Card>
            <CardBody>
              <KycForm
                m={m}
                transactionId={tx}
                defaults={{
                  firstName: user?.profile?.firstName,
                  lastName: user?.profile?.lastName,
                }}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
