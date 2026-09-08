import { defineRoute, jsonOk, requirePrincipal } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { createTransactionSchema, listTransactionsSchema } from '@/lib/validation/schemas';
import { createTransaction, listTransactionsForUser } from '@/server/services/transaction';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';

export const POST = defineRoute(
  {
    permission: 'transaction.create',
    schema: createTransactionSchema,
    rateLimit: RATE_LIMITS.transactionCreate,
    // A double-tapped "Continue" on flaky hotel Wi-Fi must not create two
    // transactions, so this route requires an Idempotency-Key.
    idempotent: true,
  },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);

    let deviceId: string | null = null;
    if (body.deviceFingerprint) {
      const device = await prisma.device.upsert({
        where: {
          userId_fingerprint: { userId: principal.userId, fingerprint: body.deviceFingerprint },
        },
        update: { lastSeenAt: new Date(), lastSeenIp: ctx.ipAddress ?? null },
        create: {
          userId: principal.userId,
          fingerprint: body.deviceFingerprint,
          firstSeenIp: ctx.ipAddress ?? null,
          lastSeenIp: ctx.ipAddress ?? null,
        },
        select: { id: true },
      });
      deviceId = device.id;
    }

    const result = await createTransaction({
      userId: principal.userId,
      payoutAmountMinor: BigInt(body.payoutAmountMinor),
      countryCode: body.countryCode,
      fundingCurrency: body.fundingCurrency,
      pickupLocationId: body.pickupLocationId ?? null,
      expedited: body.expedited,
      deviceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    return jsonOk(
      {
        transactionId: result.transactionId,
        reference: result.reference,
        status: result.status,
        // The score itself is internal; only the bucket is surfaced.
        riskLevel: result.risk.level,
        kycRequired: result.risk.kycRequired,
      },
      201,
    );
  },
);

export const GET = defineRoute(
  { permission: 'transaction.read.own', schema: listTransactionsSchema, source: 'query' },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);
    const transactions = await listTransactionsForUser(principal.userId, {
      limit: body.limit,
      cursor: body.cursor,
      status: body.status,
    });

    return jsonOk({
      transactions: transactions.map((t) => ({
        id: t.id,
        reference: t.reference,
        status: t.status,
        payoutAmountMinor: t.payoutAmountMinor,
        payoutCurrency: t.payoutCurrency,
        totalChargedMinor: t.totalChargedMinor,
        fundingCurrency: t.fundingCurrency,
        createdAt: t.createdAt,
        readyAt: t.readyAt,
        completedAt: t.completedAt,
        pickupLocation: t.pickupLocation
          ? {
              branchName: t.pickupLocation.branchName,
              city: t.pickupLocation.city,
              institutionName: t.pickupLocation.institution.name,
            }
          : null,
        codeExpiresAt: t.pickupCode?.expiresAt ?? null,
      })),
      nextCursor: transactions.length === body.limit ? transactions[transactions.length - 1]?.id : null,
    });
  },
);
