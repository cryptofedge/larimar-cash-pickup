import { defineRoute, jsonOk, requirePrincipal } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { submitKycSchema } from '@/lib/validation/schemas';
import { submitKyc } from '@/server/services/compliance';

export const runtime = 'nodejs';

/**
 * Submit identity documents.
 *
 * The document number reaches the provider and is then discarded — only the last
 * four digits are persisted, and the audit record contains no more than that.
 */
export const POST = defineRoute(
  {
    permission: 'kyc.submit.own',
    schema: submitKycSchema,
    rateLimit: RATE_LIMITS.kyc,
    idempotent: true,
  },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);

    const result = await submitKyc({
      userId: principal.userId,
      firstName: body.firstName,
      lastName: body.lastName,
      dateOfBirth: body.dateOfBirth,
      documentType: body.documentType,
      documentNumber: body.documentNumber,
      documentCountry: body.documentCountry,
      residenceCountry: body.residenceCountry,
      transactionId: body.transactionId ?? null,
      ipAddress: ctx.ipAddress,
    });

    return jsonOk({ status: result.status, verificationId: result.verificationId }, 201);
  },
);
