import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from '@/i18n';
import { getCurrentPrincipal, isFullyAuthenticated } from '@/server/auth/session';
import { hasPermission } from '@/server/auth/rbac';
import { Logo } from '@/components/brand/Logo';
import { DemoBanner, SiteFooter } from '@/components/layout/SiteChrome';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';

/**
 * Customer application shell.
 *
 * Authentication is enforced here, on the server, before any child renders. A
 * customer surface is never reachable without a valid session, and this check
 * runs in addition to the per-endpoint permission checks in the API layer —
 * neither is trusted to be the only gate.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();

  if (!principal || !isFullyAuthenticated(principal)) {
    redirect('/signin');
  }
  if (!hasPermission(principal.roles, 'transaction.read.own')) {
    redirect('/');
  }

  const nav = [
    { href: '/dashboard', label: m.nav.dashboard },
    { href: '/transactions', label: m.nav.transactions },
    { href: '/locations', label: m.nav.locations },
    { href: '/profile', label: m.nav.profile },
  ];

  return (
    <>
      <DemoBanner m={m} />

      <header className="sticky top-0 z-40 border-b border-navy-100 bg-white">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link href="/dashboard" aria-label="Larimar">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-navy-600 md:flex">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-navy-900">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <LocaleSwitcher locale={locale} label={m.common.language} />
            <form action="/signout" method="post">
              <button type="submit" className="btn-secondary px-4 text-sm">
                {m.common.signOut}
              </button>
            </form>
          </div>
        </div>

        {/* Mobile nav: the primary device is a phone. */}
        <nav className="flex overflow-x-auto border-t border-navy-100 md:hidden">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap px-4 py-3 text-sm font-medium text-navy-600"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="flex-1 bg-navy-50/40">
        <div className="container-page py-8">{children}</div>
      </main>

      <SiteFooter m={m} />
    </>
  );
}
