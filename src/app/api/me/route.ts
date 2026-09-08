import { defineRoute, jsonOk, requirePrincipal } from '@/server/http/api';
import { getCurrentUser } from '@/server/services/auth';
import { getActiveRiskPolicy } from '@/server/services/transaction';
import { computeLimitUsage } from '@/lib/domain/risk';
import { prisma } from '@/server/db';
import { env } from '@/server/env';

export const runtime = 'nodejs';

export const GET = defineRoute({ permission: 'profile.read.own' }, async ({ ctx }) => {
  const principal = requirePrincipal(ctx);
  const user = await getCurrentUser(principal.userId);
  if (!user) return jsonOk({ user: null }, 404);

  const policy = await getActiveRiskPolicy(env.DEFAULT_COUNTRY);
  const now = new Date();
  const dayStart = new Date(now.getTime() - 24 * 3600 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [daily, monthly] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        userId: principal.userId,
        createdAt: { gte: dayStart },
        status: { in: ['PAYMENT_AUTHORIZED', 'COMPLIANCE_REVIEW', 'READY_FOR_PICKUP', 'PARTIALLY_PICKED_UP', 'PICKED_UP'] },
      },
      _sum: { totalChargedMinor: true },
    }),
    prisma.transaction.aggregate({
      where: {
        userId: principal.userId,
        createdAt: { gte: monthStart },
        status: { in: ['PAYMENT_AUTHORIZED', 'COMPLIANCE_REVIEW', 'READY_FOR_PICKUP', 'PARTIALLY_PICKED_UP', 'PICKED_UP'] },
      },
      _sum: { totalChargedMinor: true },
    }),
  ]);

  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      status: user.status,
      locale: user.locale,
      mfaEnabled: user.mfaEnabled,
      emailVerified: user.emailVerifiedAt !== null,
      firstName: user.profile?.firstName ?? null,
      lastName: user.profile?.lastName ?? null,
      roles: user.roles.map((r) => r.role.name),
      kycLevel: user.identityVerifications[0]?.level ?? 'NONE',
      createdAt: user.createdAt,
    },
    limits: computeLimitUsage(
      daily._sum.totalChargedMinor ?? 0n,
      monthly._sum.totalChargedMinor ?? 0n,
      policy,
    ),
  });
});
