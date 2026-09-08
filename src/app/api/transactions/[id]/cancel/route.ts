import { defineRoute, jsonOk, requirePrincipal } from '@/server/http/api';
import { cancelTransactionSchema } from '@/lib/validation/schemas';
import { cancelTransaction } from '@/server/services/transaction';

export const runtime = 'nodejs';

export const POST = defineRoute(
  { permission: 'transaction.cancel.own', schema: cancelTransactionSchema },
  async ({ body, ctx, params }) => {
    const principal = requirePrincipal(ctx);
    await cancelTransaction({
      transactionId: params.id as string,
      userId: principal.userId,
      reason: body.reason,
      ipAddress: ctx.ipAddress,
    });
    return jsonOk({ cancelled: true });
  },
);
