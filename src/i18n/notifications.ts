/**
 * Notification templates.
 *
 * Kept separate from UI copy because these are rendered server-side into a
 * database row at the moment an event occurs, and must be stable text rather than
 * React. Both locales are required for every event — the type enforces it.
 *
 * Note what is NOT here: no pickup code, no amount that could identify a
 * transaction to someone reading a lock screen, no document details. A push
 * notification is visible to anyone holding the phone.
 */

import { interpolate, type Locale } from './config';
import type { NotificationEvent } from '@/server/providers/notifications';

interface Template {
  readonly subject: string;
  readonly body: string;
}

type Catalogue = Readonly<Record<NotificationEvent, Template>>;

const EN: Catalogue = {
  'account.created': {
    subject: 'Welcome to Larimar',
    body: 'Your Larimar account is ready. This is a demonstration environment — no real money moves.',
  },
  'account.emailVerification': {
    subject: 'Verify your email address',
    body: 'Confirm your email address to finish setting up your Larimar account.',
  },
  'account.passwordReset': {
    subject: 'Reset your Larimar password',
    body: 'A password reset was requested for your account. If this was not you, ignore this message.',
  },
  'kyc.required': {
    subject: 'Identity verification needed',
    body: 'Transaction {reference} needs identity verification before we can release cash.',
  },
  'kyc.approved': {
    subject: 'Identity verified',
    body: 'Your identity has been verified. You can now continue with your transaction.',
  },
  'kyc.rejected': {
    subject: 'We could not verify your identity',
    body: 'We were unable to verify your identity. Contact support if you believe this is a mistake.',
  },
  'payment.succeeded': {
    subject: 'Payment received',
    body: 'We received your payment for transaction {reference}. Your pickup code is in your dashboard.',
  },
  'payment.failed': {
    subject: 'Payment could not be completed',
    body: 'The payment for transaction {reference} was declined. You can try a different method.',
  },
  'pickup.ready': {
    subject: 'Your pesos are ready to collect',
    body: 'Transaction {reference} is ready. Open your dashboard for the pickup code, and bring photo identification.',
  },
  'pickup.reminder': {
    subject: 'Your pickup code expires soon',
    body: 'Transaction {reference} expires on {date}. Collect your cash before then.',
  },
  'pickup.completed': {
    subject: 'Cash collected',
    body: 'Transaction {reference} is complete. Thank you for using Larimar.',
  },
  'transaction.expired': {
    subject: 'Transaction expired',
    body: 'Transaction {reference} expired before collection. A refund will be processed.',
  },
  'refund.initiated': {
    subject: 'Refund started',
    body: 'A refund for transaction {reference} has been started. Allow several business days.',
  },
  'security.suspiciousActivity': {
    subject: 'Unusual activity on your account',
    body: 'We noticed unusual activity on your Larimar account. If this was not you, change your password immediately.',
  },
  'security.alert': {
    subject: 'Security alert',
    body: 'A security-relevant change was made to your Larimar account.',
  },
};

const ES: Catalogue = {
  'account.created': {
    subject: 'Bienvenido a Larimar',
    body: 'Tu cuenta de Larimar está lista. Este es un entorno de demostración — no se mueve dinero real.',
  },
  'account.emailVerification': {
    subject: 'Verifica tu correo electrónico',
    body: 'Confirma tu correo electrónico para terminar de configurar tu cuenta de Larimar.',
  },
  'account.passwordReset': {
    subject: 'Restablece tu contraseña de Larimar',
    body: 'Se solicitó restablecer la contraseña de tu cuenta. Si no fuiste tú, ignora este mensaje.',
  },
  'kyc.required': {
    subject: 'Se requiere verificación de identidad',
    body: 'La transacción {reference} necesita verificación de identidad antes de poder entregar el efectivo.',
  },
  'kyc.approved': {
    subject: 'Identidad verificada',
    body: 'Tu identidad ha sido verificada. Ya puedes continuar con tu transacción.',
  },
  'kyc.rejected': {
    subject: 'No pudimos verificar tu identidad',
    body: 'No pudimos verificar tu identidad. Contacta a soporte si crees que es un error.',
  },
  'payment.succeeded': {
    subject: 'Pago recibido',
    body: 'Recibimos tu pago para la transacción {reference}. Tu código de retiro está en tu panel.',
  },
  'payment.failed': {
    subject: 'No se pudo completar el pago',
    body: 'El pago de la transacción {reference} fue rechazado. Puedes intentar con otro método.',
  },
  'pickup.ready': {
    subject: 'Tus pesos están listos para recoger',
    body: 'La transacción {reference} está lista. Abre tu panel para ver el código de retiro y lleva una identificación con foto.',
  },
  'pickup.reminder': {
    subject: 'Tu código de retiro vence pronto',
    body: 'La transacción {reference} vence el {date}. Recoge tu efectivo antes de esa fecha.',
  },
  'pickup.completed': {
    subject: 'Efectivo recogido',
    body: 'La transacción {reference} está completa. Gracias por usar Larimar.',
  },
  'transaction.expired': {
    subject: 'Transacción vencida',
    body: 'La transacción {reference} venció antes de ser recogida. Se procesará un reembolso.',
  },
  'refund.initiated': {
    subject: 'Reembolso iniciado',
    body: 'Se ha iniciado un reembolso para la transacción {reference}. Puede tardar varios días hábiles.',
  },
  'security.suspiciousActivity': {
    subject: 'Actividad inusual en tu cuenta',
    body: 'Detectamos actividad inusual en tu cuenta de Larimar. Si no fuiste tú, cambia tu contraseña de inmediato.',
  },
  'security.alert': {
    subject: 'Alerta de seguridad',
    body: 'Se realizó un cambio relevante para la seguridad de tu cuenta de Larimar.',
  },
};

const CATALOGUES: Readonly<Record<Locale, Catalogue>> = Object.freeze({ en: EN, es: ES });

export function renderNotification(
  event: NotificationEvent,
  locale: Locale,
  variables: Record<string, string>,
): { subject: string; body: string } {
  const template = (CATALOGUES[locale] ?? EN)[event];
  return {
    subject: interpolate(template.subject, variables),
    body: interpolate(template.body, variables),
  };
}
