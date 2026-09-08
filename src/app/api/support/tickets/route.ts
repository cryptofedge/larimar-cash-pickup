import { defineRoute, jsonOk } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { supportTicketSchema } from '@/lib/validation/schemas';
import { prisma } from '@/server/db';
import { generateReference } from '@/server/auth/crypto';
import { writeAudit } from '@/server/services/audit';

export const runtime = 'nodejs';

/** Open a support ticket. Public, so a customer locked out can still reach us. */
export const POST = defineRoute(
  { permission: null, schema: supportTicketSchema, rateLimit: RATE_LIMITS.support },
  async ({ body, ctx }) => {
    const ticketNumber = generateReference('TKT');

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber,
        userId: ctx.principal?.userId ?? null,
        transactionId: body.transactionId ?? null,
        subject: body.subject,
        body: body.body,
        category: body.category,
        contactEmail: body.contactEmail,
        status: 'OPEN',
      },
      select: { id: true, ticketNumber: true },
    });

    await writeAudit({
      actorId: ctx.principal?.userId ?? null,
      actorType: ctx.principal ? 'customer' : 'anonymous',
      action: 'support.ticket.create',
      resourceType: 'support_ticket',
      resourceId: ticket.id,
      metadata: { category: body.category, ticketNumber: ticket.ticketNumber },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return jsonOk({ ticketNumber: ticket.ticketNumber }, 201);
  },
);
