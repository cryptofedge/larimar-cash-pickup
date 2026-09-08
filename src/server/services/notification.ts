/**
 * Notification service (outbox pattern).
 *
 * `enqueue` writes a row inside the caller's database transaction. Delivery is a
 * separate step that runs after commit. If the business transaction rolls back,
 * the notification was never persisted and therefore can never be delivered —
 * which is the whole point. Telling a customer their pesos are ready for a
 * transaction that did not commit would be worse than telling them nothing.
 */

import { prisma, type PrismaTransactionClient } from '../db';
import {
  getNotificationTransport,
  type NotificationChannel,
  type NotificationEvent,
} from '../providers/notifications';
import { renderNotification } from '@/i18n/notifications';
import type { Locale } from '@/i18n/config';

export interface EnqueueInput {
  readonly userId?: string | null;
  readonly transactionId?: string | null;
  readonly channel: NotificationChannel;
  readonly event: NotificationEvent;
  readonly recipient: string;
  readonly locale: Locale;
  readonly variables?: Record<string, string>;
}

export async function enqueueNotification(
  input: EnqueueInput,
  client: PrismaTransactionClient,
): Promise<string> {
  const rendered = renderNotification(input.event, input.locale, input.variables ?? {});

  const row = await client.notification.create({
    data: {
      userId: input.userId ?? null,
      transactionId: input.transactionId ?? null,
      channel: input.channel,
      eventKey: input.event,
      recipient: input.recipient,
      locale: input.locale === 'es' ? 'ES' : 'EN',
      subject: rendered.subject,
      body: rendered.body,
      status: 'QUEUED',
    },
    select: { id: true },
  });

  return row.id;
}

/**
 * Deliver queued notifications.
 *
 * Called after commit in the request path and by a scheduled job for anything
 * missed. Failures are recorded, never thrown — a transport outage must not undo
 * a completed financial operation.
 */
export async function flushNotifications(limit = 50): Promise<{ sent: number; failed: number }> {
  const queued = await prisma.notification.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let sent = 0;
  let failed = 0;

  for (const notification of queued) {
    try {
      const transport = getNotificationTransport(notification.channel);
      const result = await transport.send({
        channel: notification.channel,
        event: notification.eventKey as NotificationEvent,
        recipient: notification.recipient,
        locale: notification.locale,
        subject: notification.subject ?? undefined,
        body: notification.body,
      });

      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: result.delivered ? 'SENT' : 'FAILED',
          provider: transport.name,
          providerRef: result.providerRef ?? null,
          failureReason: result.failureReason ?? null,
          sentAt: result.delivered ? new Date() : null,
        },
      });

      if (result.delivered) sent += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'FAILED',
          failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
        },
      });
    }
  }

  return { sent, failed };
}
