import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from '@/i18n';
import { getCurrentPrincipal, isFullyAuthenticated } from '@/server/auth/session';
import { hasPermission } from '@/server/auth/rbac';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';

/**
 * Payout portal shell.
 *
 * A separate surface from the customer app, with its own authorisation gate.
 * Reaching any page here requires `pickup.verify`, which only PICKUP_AGENT and
 * PICKUP_MANAGER hold — a customer, a support agent, and a finance admin are all
 * refused at this boundary.
 */
export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();

  if (!principal || !isFullyAuthenticated(principal)) {
    redirect('/signin?next=/agent');
  }
  if (!hasPermission(principal.roles, 'pickup.verify')) {
    redirect('/');
  }

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/60">
      <div className="bg-navy-900 px-4 py-2 text-center text-xs text-navy-100">
        <span className="font-semibold text-sand-400">{m.footer.demoBannerTitle}</span>
        <span className="mx-2 text-navy-500">·</span>
        <span>{m.footer.demoBannerBody}</span>
      </div>

      <header className="border-b border-navy-100 bg-white">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link href="/agent" className="flex items-center gap-3">
            <Logo showWordmark={false} />
            <span className="text-sm font-semibold text-navy-900">{m.nav.agentPortal}</span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-navy-500 sm:inline">{principal.email}</span>
            <LocaleSwitcher locale={locale} label={m.common.language} />
            <form action="/signout" method="post">
              <button type="submit" className="btn-secondary px-4 text-sm">
                {m.common.signOut}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        <div className="container-page py-8">{children}</div>
      </main>

      <footer className="border-t border-navy-100 bg-white py-4">
        <p className="container-page text-center text-xs text-navy-400">{m.agent.privacyNote}</p>
      </footer>
    </div>
  );
}
