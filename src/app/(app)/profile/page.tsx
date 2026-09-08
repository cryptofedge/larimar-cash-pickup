import Link from 'next/link';
import { getTranslations, formatDate } from '@/i18n';
import { getCurrentPrincipal } from '@/server/auth/session';
import { getCurrentUser } from '@/server/services/auth';
import { prisma } from '@/server/db';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';

export const metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const { m, locale } = await getTranslations();
  const principal = await getCurrentPrincipal();
  if (!principal) return null;

  const [user, sessions, devices] = await Promise.all([
    getCurrentUser(principal.userId),
    prisma.session.findMany({
      where: { userId: principal.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
      select: { id: true, ipAddress: true, userAgent: true, lastSeenAt: true, createdAt: true },
    }),
    prisma.device.findMany({
      where: { userId: principal.userId },
      orderBy: { lastSeenAt: 'desc' },
      take: 5,
      select: { id: true, label: true, lastSeenIp: true, lastSeenAt: true, trusted: true },
    }),
  ]);

  if (!user) return null;

  const verified = user.identityVerifications[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={m.nav.profile} />

      <Card>
        <CardHeader title={m.nav.profile} />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label={m.auth.firstName} value={user.profile?.firstName ?? '—'} />
            <Field label={m.auth.lastName} value={user.profile?.lastName ?? '—'} />
            <Field label={m.auth.email} value={user.email} />
            <Field
              label={m.common.status}
              value={user.status}
            />
            <Field
              label={m.kyc.title}
              value={verified ? `${m.kyc.approvedTitle} (${verified.level})` : m.kyc.title}
            />
            <Field label={m.transaction.created} value={formatDate(user.createdAt, locale)} />
          </dl>

          {!verified ? (
            <Link href="/verify-identity" className="btn-primary mt-5">
              {m.dashboard.kycBannerCta}
            </Link>
          ) : null}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------- Security */}
      <Card>
        <CardHeader title={m.security.accountTitle} description={m.security.accountBody} />
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-navy-100 p-4">
            <div>
              <p className="font-medium text-navy-900">{m.auth.mfaTitle}</p>
              <p className="text-sm text-navy-500">{m.auth.mfaSubtitle}</p>
            </div>
            <Badge tone={user.mfaEnabled ? 'success' : 'neutral'}>
              {user.mfaEnabled ? m.common.yes : m.common.no}
            </Badge>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-navy-900">
              {locale === 'es' ? 'Sesiones activas' : 'Active sessions'}
            </h3>
            <ul className="divide-y divide-navy-100 rounded-xl border border-navy-100">
              {sessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-navy-700">{session.ipAddress ?? '—'}</p>
                    <p className="truncate text-xs text-navy-400">
                      {session.userAgent?.slice(0, 60) ?? '—'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-navy-400">
                    {formatDate(session.lastSeenAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {devices.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-navy-900">
                {locale === 'es' ? 'Dispositivos' : 'Devices'}
              </h3>
              <ul className="divide-y divide-navy-100 rounded-xl border border-navy-100">
                {devices.map((device) => (
                  <li key={device.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                    <span className="text-navy-700">{device.label ?? device.lastSeenIp ?? '—'}</span>
                    <span className="text-xs text-navy-400">
                      {formatDate(device.lastSeenAt, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Link href="/forgot-password" className="btn-secondary">
            {m.auth.resetPasswordTitle}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-navy-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-navy-900">{value}</dd>
    </div>
  );
}
