import { defineRoute, jsonOk, requirePrincipal } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { confirmPaymentSchema } from '@/lib/validation/schemas';
import { confirmPayment, createPaymentIntent } from '@/server/services/payment';

export const runtime = 'nodejs';

/** Create (or reuse) a payment intent. Returns a client secret, never card data. */
export const POST = defineRoute(
  { permission: 'transaction.create', rateLimit: RATE_LIMITS.payment, idempotent: true },
  async ({ ctx, params, req }) => {
    const principal = requirePrincipal(ctx);
    const result = await createPaymentIntent({
      transactionId: params.id as string,
      userId: principal.userId,
      idempotencyKey: req.headers.get('idempotency-key') ?? ctx.requestId,
      ipAddress: ctx.ipAddress,
    });
    return jsonOk(result, 201);
  },
);

/**
 * Confirm the payment with a provider token.
 *
 * This is the single most important endpoint in the application: it moves money,
 * posts the ledger, and issues a cash credential. It is idempotent, rate limited,
 * and re-validates the quote before authorising anything.
 */
export const PUT = defineRoute(
  {
    permission: 'transaction.create',
    schema: confirmPaymentSchema,
    rateLimit: RATE_LIMITS.payment,
    idempotent: true,
  },
  async ({ body, ctx, params, req }) => {
    const principal = requirePrincipal(ctx);

    const result = await confirmPayment({
      transactionId: params.id as string,
      userId: principal.userId,
      paymentToken: body.paymentToken,
      idempotencyKey: req.headers.get('idempotency-key') ?? ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return jsonOk({
      status: result.status,
      transactionId: result.transactionId,
      reference: result.reference,
      // The plaintext code is returned exactly once, to the paying customer, and
      // is not retrievable from any later endpoint.
      pickupCode: result.credential?.code ?? null,
      pickupSecret: result.credential?.secret ?? null,
      expiresAt: result.credential?.expiresAt ?? null,
      actionUrl: result.actionUrl ?? null,
      failureCode: result.failureCode ?? null,
      failureMessage: result.failureMessage ?? null,
    });
  },
);
