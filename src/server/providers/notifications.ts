/**
 * Notification transports.
 *
 * An outbox pattern: services never call a transport directly, they persist a
 * Notification row inside the same database transaction as the business change.
 * If the transaction rolls back, no message is sent — a customer never receives
 * "your pesos are ready" for a transaction that did not commit.
 *
 * The mock transports deliver nothing. They record and log.
 */

import { env } from '../env';

export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH';

/** Every notification the platform can emit. Bodies come from i18n, never hardcoded. */
export const NOTIFICATION_EVENTS = [
  'account.created',
  'account.emailVerification',
  'account.passwordReset',
  'kyc.required',
  'kyc.approved',
  'kyc.rejected',
  'payment.succeeded',
  'payment.failed',
  'pickup.ready',
  'pickup.reminder',
  'pickup.completed',
  'transaction.expired',
  'refund.initiated',
  'security.suspiciousActivity',
  'security.alert',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export interface NotificationMessage {
  readonly channel: NotificationChannel;
  readonly event: NotificationEvent;
  readonly recipient: string;
  readonly locale: 'EN' | 'ES';
  readonly subject?: string;
  readonly body: string;
}

export interface NotificationSendResult {
  readonly delivered: boolean;
  readonly providerRef?: string;
  readonly failureReason?: string;
}

export interface NotificationTransport {
  readonly name: string;
  readonly channel: NotificationChannel;
  send(message: NotificationMessage): Promise<NotificationSendResult>;
}

/** Captured sends, so tests can assert what would have gone out. */
const sent: NotificationMessage[] = [];

class MockTransport implements NotificationTransport {
  readonly name: string;
  constructor(readonly channel: NotificationChannel) {
    this.name = `mock-${channel.toLowerCase()}`;
  }

  async send(message: NotificationMessage): Promise<NotificationSendResult> {
    sent.push(message);
    if (env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log(
        `[notification:${this.channel}] -> ${redactRecipient(message.recipient)} :: ${message.event}`,
      );
    }
    return { delivered: true, providerRef: `mock_${Date.now()}_${sent.length}` };
  }
}

/** Never log a full address or phone number. */
function redactRecipient(recipient: string): string {
  if (recipient.includes('@')) {
    const [local, domain] = recipient.split('@');
    return `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`;
  }
  return `***${recipient.slice(-4)}`;
}

const transports: Record<NotificationChannel, NotificationTransport> = {
  EMAIL: new MockTransport('EMAIL'),
  SMS: new MockTransport('SMS'),
  WHATSAPP: new MockTransport('WHATSAPP'),
  PUSH: new MockTransport('PUSH'),
};

export function getNotificationTransport(channel: NotificationChannel): NotificationTransport {
  if (env.NOTIFICATION_TRANSPORT !== 'mock') {
    throw new Error(
      `No NotificationTransport implementation for "${env.NOTIFICATION_TRANSPORT}".`,
    );
  }
  return transports[channel];
}

/** Test helpers. */
export function getSentNotifications(): readonly NotificationMessage[] {
  return sent;
}

export function clearSentNotifications(): void {
  sent.length = 0;
}
