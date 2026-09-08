import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import type { Messages } from '@/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import type { Locale } from '@/i18n/config';

/**
 * The demo banner.
 *
 * Sits above everything, on every page, and cannot be dismissed. This platform
 * looks like a real financial product by design, which makes an unmissable,
 * permanent statement that it is not one a requirement rather than a courtesy.
 */
export function DemoBanner({ m }: { m: Messages }) {
  return (
    <div className="bg-navy-900 px-4 py-2 text-center text-xs text-navy-100">
      <span className="font-semibold text-sand-400">{m.footer.demoBannerTitle}</span>
      <span className="mx-2 text-navy-500">·</span>
      <span>{m.footer.demoBannerBody}</span>
    </div>
  );
}

export function SiteHeader({
  m,
  locale,
  signedIn,
  isStaff,
}: {
  m: Messages;
  locale: Locale;
  signedIn: boolean;
  isStaff?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-navy-100 bg-white/95 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href="/" className="shrink-0" aria-label="Larimar home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-navy-600 md:flex">
          <Link href="/how-it-works" className="hover:text-navy-900">
            {m.nav.howItWorks}
          </Link>
          <Link href="/fees" className="hover:text-navy-900">
            {m.nav.fees}
          </Link>
          <Link href="/locations" className="hover:text-navy-900">
            {m.nav.locations}
          </Link>
          <Link href="/security" className="hover:text-navy-900">
            {m.nav.security}
          </Link>
          <Link href="/help" className="hover:text-navy-900">
            {m.nav.help}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <LocaleSwitcher locale={locale} label={m.common.language} />
          {signedIn ? (
            <>
              {isStaff ? null : (
                <Link href="/dashboard" className="btn-ghost hidden px-3 text-sm sm:inline-flex">
                  {m.nav.dashboard}
                </Link>
              )}
              <form action="/signout" method="post">
                <button type="submit" className="btn-secondary px-4 text-sm">
                  {m.common.signOut}
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/signin" className="btn-ghost hidden px-3 text-sm sm:inline-flex">
                {m.nav.signIn}
              </Link>
              <Link href="/signup" className="btn-primary px-4 text-sm">
                {m.nav.createAccount}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ m }: { m: Messages }) {
  const columns = [
    {
      title: m.footer.product,
      links: [
        { href: '/how-it-works', label: m.nav.howItWorks },
        { href: '/fees', label: m.nav.fees },
        { href: '/locations', label: m.nav.locations },
        { href: '/security', label: m.nav.security },
      ],
    },
    {
      title: m.footer.supportSection,
      links: [
        { href: '/help', label: m.nav.help },
        { href: '/faq', label: m.nav.faq },
        { href: '/contact', label: m.support.contactTitle },
      ],
    },
    {
      title: m.footer.legalSection,
      links: [
        { href: '/legal/terms', label: m.legal.termsTitle },
        { href: '/legal/privacy', label: m.legal.privacyTitle },
        { href: '/legal/aml', label: m.legal.amlTitle },
        { href: '/trust', label: m.legal.complianceTitle },
      ],
    },
  ];

  return (
    <footer className="mt-16 border-t border-navy-100 bg-navy-50/60">
      <div className="container-page py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-navy-500">{m.brand.tagline}</p>
          </div>
          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold text-navy-900">{column.title}</h3>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-navy-500 hover:text-navy-900">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-navy-200 pt-6">
          <p className="text-sm font-medium text-navy-700">
            &copy; {new Date().getFullYear()} {m.brand.name}. {m.footer.rights}
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-navy-500">
            {m.legal.demoDisclaimerBody}
          </p>
        </div>
      </div>
    </footer>
  );
}
