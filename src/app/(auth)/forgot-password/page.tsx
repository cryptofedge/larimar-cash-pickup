import Link from 'next/link';
import { getTranslations } from '@/i18n';
import { Card, CardBody } from '@/components/ui';
import { RequestResetForm } from '@/components/auth/PasswordResetForms';

export const metadata = { title: 'Reset password' };

export default async function ForgotPasswordPage() {
  const { m } = await getTranslations();

  return (
    <Card>
      <CardBody>
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">
          {m.auth.resetPasswordTitle}
        </h1>
        <p className="mt-1 text-navy-500">{m.auth.resetPasswordSubtitle}</p>

        <div className="mt-6">
          <RequestResetForm m={m} />
        </div>

        <p className="mt-4 text-center text-sm">
          <Link href="/signin" className="text-larimar-700 hover:underline">
            {m.common.back}
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
