import { getTranslations } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { isStaff } from '@/server/auth/rbac';
import { DemoBanner, SiteFooter, SiteHeader } from '@/components/layout/SiteChrome';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();

  return (
    <>
      <DemoBanner m={m} />
      <SiteHeader
        m={m}
        locale={locale}
        signedIn={principal !== null}
        isStaff={principal ? isStaff(principal.roles) : false}
      />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter m={m} />
    </>
  );
}
