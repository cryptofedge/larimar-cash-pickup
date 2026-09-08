import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from '@/i18n';
import { getCurrentPrincipal, isFullyAuthenticated } from '@/server/auth/session';
import { hasAnyPermission } from '@/server/auth/rbac';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';

/**
 * Admin console shell.
 *
 * Reachable by several staff roles with very different powers — a support agent
 * can read a transaction but not touch money; a compliance analyst can hold and
 * release; a finance admin can refund. The nav below is filtered by permission,
 * and every action behind it is checked again server-side. Hiding a link is
 * presentation, not security.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();

  if (!principal || !isFullyAuthenticated(principal)) {
    redirect('/signin?next=/admin');
  }
  if (!hasAnyPermission(principal.roles, ['admin.dashboard.read', 'transaction.read.any'])) {
    redirect('/');
  }

  const nav = [
    { href: '/admin', label: m.admin.overview, permission: 'admin.dashboard.read' as const },
    { href: '/admin/transactions', label: m.admin.transactions, permission: 'transaction.read.any' as const },
    { href: '/admin/compliance', label: m.admin.compliance, permission: 'compliance.case.read' as const },
    { href: '/admin/ledger', label: m.admin.ledger, permission: 'ledger.read' as const },
    { href: '/admin/settlement', label: 'Settlement', permission: 'settlement.read' as const },
    { href: '/admin/locations', label: m.admin.locations, permission: 'pickup.location.read' as const },
    { href: '/admin/audit', label: m.admin.auditLog, permission: 'admin.audit.read' as const },
  ].filter((item) => hasAnyPermission(principal.roles, [item.permission]));

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/60">
      <div className="bg-navy-900 px-4 py-2 text-center text-xs text-navy-100">
        <span className="font-semibold text-sand-400">{m.footer.demoBannerTitle}</span>
        <span className="mx-2 text-navy-500">·</span>
        <span>{m.footer.demoBannerBody}</span>
      </div>

      <header className="border-b border-navy-100 bg-white">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link href="/admin" className="flex items-center gap-3">
            <Logo showWordmark={false} />
            <span className="text-sm font-semibold text-navy-900">{m.admin.consoleTitle}</span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-navy-400 sm:inline">
              {principal.email} · {principal.roles.join(', ')}
            </span>
            <LocaleSwitcher locale={locale} label={m.common.language} />
            <form action="/signout" method="post">
              <button type="submit" className="btn-secondary px-4 text-sm">
                {m.common.signOut}
              </button>
            </form>
          </div>
        </div>

        <nav className="container-page flex gap-1 overflow-x-auto border-t border-navy-100 py-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-navy-600 hover:bg-navy-50 hover:text-navy-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="flex-1">
        <div className="container-page py-8">{children}</div>
      </main>
    </div>
  );
}
