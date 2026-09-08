import Link from 'next/link';
import { Suspense } from 'react';
import { getTranslations } from '@/i18n';
import { Card, CardBody } from '@/components/ui';
import { SignInForm } from '@/components/auth/SignInForm';
import { env } from '@/server/env';

export const metadata = { title: 'Sign in' };

const DEMO_ACCOUNTS = [
  { email: 'customer@example.com', role: 'Customer' },
  { email: 'agent@example.com', role: 'Payout agent' },
  { email: 'compliance@example.com', role: 'Compliance analyst' },
  { email: 'admin@example.com', role: 'System admin' },
];

export default async function SignInPage() {
  const { m } = await getTranslations();

  return (
    <>
      <Card>
        <CardBody>
          <h1 className="text-2xl font-bold tracking-tight text-navy-900">{m.auth.signInTitle}</h1>
          <p className="mt-1 text-navy-500">{m.auth.signInSubtitle}</p>

          <div className="mt-6">
            <Suspense fallback={<p className="text-sm text-navy-400">{m.common.loading}</p>}>
              <SignInForm m={m} />
            </Suspense>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <Link href="/forgot-password" className="text-larimar-700 hover:underline">
              {m.auth.forgotPassword}
            </Link>
            <span className="text-navy-500">
              {m.auth.noAccount}{' '}
              <Link href="/signup" className="font-medium text-larimar-700 hover:underline">
                {m.nav.createAccount}
              </Link>
            </span>
          </div>
        </CardBody>
      </Card>

      {env.DEMO_MODE ? (
        <Card className="mt-4 border-dashed">
          <CardBody>
            <h2 className="text-sm font-semibold text-navy-900">Demo accounts</h2>
            <p className="mt-1 text-xs text-navy-500">
              Password for every account: <code className="font-mono">{env.DEMO_PASSWORD}</code>
            </p>
            <ul className="mt-3 space-y-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email} className="flex items-center justify-between gap-3 text-xs">
                  <code className="font-mono text-navy-700">{account.email}</code>
                  <span className="text-navy-400">{account.role}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
