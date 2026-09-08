import Link from 'next/link';
import { getTranslations } from '@/i18n';
import { Alert, Card, CardBody } from '@/components/ui';
import { CompleteResetForm } from '@/components/auth/PasswordResetForms';

export const metadata = { title: 'Set a new password' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { m } = await getTranslations();
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card>
        <CardBody className="space-y-4">
          <h1 className="text-2xl font-bold tracking-tight text-navy-900">
            {m.auth.resetPasswordTitle}
          </h1>
          <Alert tone="danger">{m.errors.validation}</Alert>
          <Link href="/forgot-password" className="btn-secondary w-full">
            {m.common.retry}
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{m.auth.newPassword}</h1>
        <p className="mt-1 text-sm text-navy-500">
          {/* Stated plainly, because it is a security-relevant consequence. */}
          {m.security.accountBody}
        </p>
        <div className="mt-6">
          <CompleteResetForm m={m} token={token} />
        </div>
      </CardBody>
    </Card>
  );
}
