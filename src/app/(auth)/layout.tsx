import Link from 'next/link';
import { getTranslations } from '@/i18n';
import { Logo } from '@/components/brand/Logo';
import { Alert } from '@/components/ui';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { m } = await getTranslations();

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/50">
      <div className="bg-navy-900 px-4 py-2 text-center text-xs text-navy-100">
        <span className="font-semibold text-sand-400">{m.footer.demoBannerTitle}</span>
        <span className="mx-2 text-navy-500">·</span>
        <span>{m.footer.demoBannerBody}</span>
      </div>

      <header className="border-b border-navy-100 bg-white">
        <div className="container-page flex h-16 items-center">
          <Link href="/" aria-label="Larimar home">
            <Logo />
          </Link>
        </div>
      </header>

      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-md">
          {children}
          <div className="mt-6">
            <Alert tone="warning">{m.auth.demoNotice}</Alert>
          </div>
        </div>
      </main>

      <footer className="border-t border-navy-100 bg-white py-4">
        <div className="container-page flex flex-wrap justify-center gap-4 text-xs text-navy-400">
          <Link href="/legal/terms" className="hover:text-navy-700">
            {m.legal.termsTitle}
          </Link>
          <Link href="/legal/privacy" className="hover:text-navy-700">
            {m.legal.privacyTitle}
          </Link>
          <Link href="/trust" className="hover:text-navy-700">
            {m.legal.complianceTitle}
          </Link>
        </div>
      </footer>
    </div>
  );
}
