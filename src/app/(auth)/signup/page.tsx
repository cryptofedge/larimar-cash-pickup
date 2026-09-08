import Link from 'next/link';
import { getTranslations } from '@/i18n';
import { Card, CardBody } from '@/components/ui';
import { SignUpForm } from '@/components/auth/SignUpForm';

export const metadata = { title: 'Create account' };

export default async function SignUpPage() {
  const { m } = await getTranslations();

  return (
    <Card>
      <CardBody>
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">{m.auth.signUpTitle}</h1>
        <p className="mt-1 text-navy-500">{m.auth.signUpSubtitle}</p>

        <div className="mt-6">
          <SignUpForm m={m} />
        </div>

        <p className="mt-4 text-center text-sm text-navy-500">
          {m.auth.haveAccount}{' '}
          <Link href="/signin" className="font-medium text-larimar-700 hover:underline">
            {m.nav.signIn}
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
