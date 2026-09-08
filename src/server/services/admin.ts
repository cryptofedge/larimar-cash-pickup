/**
 * Admin analytics and search.
 *
 * Aggregations run in the database rather than by loading rows into memory —
 * this has to stay responsive as volume grows, and pulling a million
 * transactions into Node to count them is how dashboards die.
 */

import type { Prisma, TransactionStatus } from '@prisma/client';
import { prisma } from '../db';
import { hashCode, isWellFormedCode } from '@/lib/domain/pickup-code';
import { env } from '../env';
import { verifyLedgerIntegrity } from './ledger';

const FUNDED_STATUSES: TransactionStatus[] = [
  'PAYMENT_AUTHORIZED',
  'COMPLIANCE_REVIEW',
  'READY_FOR_PICKUP',
  'PARTIALLY_PICKED_UP',
  'PICKED_UP',
];

const PENDING_STATUSES: TransactionStatus[] = [
  'CREATED',
  'CUSTOMER_DETAILS_REQUIRED',
  'KYC_REQUIRED',
  'KYC_PENDING',
  'KYC_APPROVED',
  'PAYMENT_PENDING',
];

export interface DashboardMetrics {
  totalTransactions: number;
  totalRequestedMinor: bigint;
  totalPaidOutMinor: bigint;
  totalFundedMinor: bigint;
  pendingTransactions: number;
  pendingKyc: number;
  complianceReviews: number;
  failedPayments: number;
  refunds: number;
  chargebacks: number;
  suspiciousTransactions: number;
  activeCustomers: number;
  activeLocations: number;
  dailyVolumeMinor: bigint;
  monthlyVolumeMinor: bigint;
  openFraudAlerts: number;
  ledgerBalanced: boolean;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalTransactions,
    requested,
    paidOut,
    funded,
    pendingTransactions,
    pendingKyc,
    complianceReviews,
    failedPayments,
    refunds,
    chargebacks,
    suspicious,
    activeCustomers,
    activeLocations,
    dailyVolume,
    monthlyVolume,
    openFraudAlerts,
    integrity,
  ] = await Promise.all([
    prisma.transaction.count({ where: { deletedAt: null } }),
    prisma.transaction.aggregate({ _sum: { payoutAmountMinor: true }, where: { deletedAt: null } }),
    prisma.transaction.aggregate({ _sum: { paidOutMinor: true }, where: { deletedAt: null } }),
    prisma.transaction.aggregate({
      _sum: { totalChargedMinor: true },
      where: { status: { in: FUNDED_STATUSES } },
    }),
    prisma.transaction.count({ where: { status: { in: PENDING_STATUSES }, deletedAt: null } }),
    prisma.identityVerification.count({ where: { status: 'PENDING' } }),
    prisma.transaction.count({ where: { status: 'COMPLIANCE_REVIEW' } }),
    prisma.payment.count({ where: { status: 'FAILED' } }),
    prisma.refund.count(),
    prisma.chargeback.count(),
    prisma.transaction.count({ where: { riskLevel: { in: ['HIGH', 'CRITICAL'] } } }),
    prisma.user.count({ where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { name: 'CUSTOMER' } } } } }),
    prisma.pickupLocation.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    prisma.transaction.aggregate({
      _sum: { totalChargedMinor: true },
      where: { createdAt: { gte: dayStart }, status: { in: FUNDED_STATUSES } },
    }),
    prisma.transaction.aggregate({
      _sum: { totalChargedMinor: true },
      where: { createdAt: { gte: monthStart }, status: { in: FUNDED_STATUSES } },
    }),
    prisma.fraudAlert.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
    verifyLedgerIntegrity(),
  ]);

  return {
    totalTransactions,
    totalRequestedMinor: requested._sum.payoutAmountMinor ?? 0n,
    totalPaidOutMinor: paidOut._sum.paidOutMinor ?? 0n,
    totalFundedMinor: funded._sum.totalChargedMinor ?? 0n,
    pendingTransactions,
    pendingKyc,
    complianceReviews,
    failedPayments,
    refunds,
    chargebacks,
    suspiciousTransactions: suspicious,
    activeCustomers,
    activeLocations,
    dailyVolumeMinor: dailyVolume._sum.totalChargedMinor ?? 0n,
    monthlyVolumeMinor: monthlyVolume._sum.totalChargedMinor ?? 0n,
    openFraudAlerts,
    ledgerBalanced: integrity.balanced,
  };
}

export interface VolumePoint {
  date: string;
  count: number;
  payoutMinor: bigint;
  fundingMinor: bigint;
}

/** Daily series for the dashboard charts. */
export async function getVolumeSeries(days = 30): Promise<VolumePoint[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const transactions = await prisma.transaction.findMany({
    where: { createdAt: { gte: since }, deletedAt: null },
    select: { createdAt: true, payoutAmountMinor: true, totalChargedMinor: true, status: true },
  });

  const buckets = new Map<string, VolumePoint>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    buckets.set(date, { date, count: 0, payoutMinor: 0n, fundingMinor: 0n });
  }

  for (const t of transactions) {
    const key = t.createdAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    if (FUNDED_STATUSES.includes(t.status)) {
      bucket.payoutMinor += t.payoutAmountMinor;
      bucket.fundingMinor += t.totalChargedMinor;
    }
  }

  return [...buckets.values()];
}

export async function getStatusDistribution(): Promise<{ status: string; count: number }[]> {
  const grouped = await prisma.transaction.groupBy({
    by: ['status'],
    _count: { _all: true },
    where: { deletedAt: null },
  });
  return grouped
    .map((g) => ({ status: g.status, count: g._count._all }))
    .sort((a, b) => b.count - a.count);
}

export async function getGeographicDistribution(): Promise<
  { province: string; city: string; count: number; payoutMinor: bigint }[]
> {
  const locations = await prisma.pickupLocation.findMany({
    where: { deletedAt: null },
    select: {
      city: true,
      province: true,
      transactions: {
        where: { deletedAt: null },
        select: { payoutAmountMinor: true, status: true },
      },
    },
  });

  const byCity = new Map<string, { province: string; city: string; count: number; payoutMinor: bigint }>();
  for (const location of locations) {
    const key = `${location.province}|${location.city}`;
    const entry = byCity.get(key) ?? {
      province: location.province,
      city: location.city,
      count: 0,
      payoutMinor: 0n,
    };
    for (const t of location.transactions) {
      entry.count += 1;
      if (FUNDED_STATUSES.includes(t.status)) entry.payoutMinor += t.payoutAmountMinor;
    }
    byCity.set(key, entry);
  }

  return [...byCity.values()].sort((a, b) => b.count - a.count);
}

export interface AdminSearchOptions {
  q?: string;
  status?: TransactionStatus[];
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  locationId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * Transaction search.
 *
 * A pickup code entered here is hashed and matched against the stored hash —
 * support can find a transaction from a code a customer reads out, without the
 * plaintext ever being stored or the search leaking which codes exist.
 */
export async function searchTransactions(options: AdminSearchOptions) {
  const where: Prisma.TransactionWhereInput = { deletedAt: null };
  const filters: Prisma.TransactionWhereInput[] = [];

  if (options.q) {
    const q = options.q.trim();
    const or: Prisma.TransactionWhereInput[] = [
      { reference: { contains: q, mode: 'insensitive' } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
    ];

    if (/^[0-9a-f-]{36}$/i.test(q)) or.push({ id: q });

    if (isWellFormedCode(q)) {
      or.push({ pickupCode: { codeHash: hashCode(q, env.PICKUP_CODE_PEPPER) } });
    }

    filters.push({ OR: or });
  }

  if (options.status?.length) filters.push({ status: { in: options.status } });
  if (options.riskLevel) filters.push({ riskLevel: options.riskLevel });
  if (options.locationId) filters.push({ pickupLocationId: options.locationId });
  if (options.from || options.to) {
    filters.push({
      createdAt: {
        ...(options.from ? { gte: options.from } : {}),
        ...(options.to ? { lte: options.to } : {}),
      },
    });
  }

  if (filters.length > 0) where.AND = filters;

  return prisma.transaction.findMany({
    where,
    include: {
      user: { select: { id: true, email: true } },
      pickupLocation: { select: { branchName: true, city: true } },
      pickupCode: { select: { status: true, expiresAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
  });
}

export async function listAuditLog(limit = 100, resourceId?: string) {
  return prisma.auditLog.findMany({
    where: resourceId ? { resourceId } : {},
    include: { actor: { select: { email: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function listRecentPickupEvents(limit = 50) {
  return prisma.pickupEvent.findMany({
    include: {
      agent: { select: { email: true } },
      location: { select: { branchName: true, city: true } },
      transaction: { select: { reference: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
