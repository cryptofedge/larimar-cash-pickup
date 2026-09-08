/**
 * FAQ content, bilingual.
 *
 * Kept as data rather than markup so the same items feed the landing page, the
 * FAQ page, and the help centre without duplication. Answers are written to be
 * honest about what this build is — several of them exist specifically to stop a
 * reader assuming this is an operating financial service.
 */

import type { Locale } from '@/i18n/config';

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
  readonly category: 'general' | 'pricing' | 'pickup' | 'security' | 'compliance';
}

const EN: FaqItem[] = [
  {
    category: 'general',
    question: 'Is Larimar a real financial service I can use today?',
    answer:
      'No. Larimar is a technical demonstration. It is not a licensed money transmitter, payment institution, or foreign exchange dealer anywhere. It processes no real money, holds no customer funds, and has no agreements with any bank or payout institution. Every pickup location shown is fictional.',
  },
  {
    category: 'general',
    question: 'How does it work?',
    answer:
      'You enter the amount of Dominican pesos you want to receive. We show you the exchange rate, every fee, and the exact total your card would be charged. After payment, you receive a pickup code. You take that code and a government-issued ID to an authorized location, and the agent verifies both before handing over the cash.',
  },
  {
    category: 'general',
    question: 'Why not just use an ATM?',
    answer:
      'You can, and sometimes you should. The case for this approach is that it replaces several card-present events with one card-not-present event on your own device, at a price you see in full beforehand. Every physical use of a foreign card at an unfamiliar terminal is another opportunity for skimming.',
  },
  {
    category: 'pricing',
    question: 'What does it cost?',
    answer:
      'Three components, all shown before you pay: a platform fee, a payment processing fee charged by the card processor, and an exchange rate margin. We show the margin as its own line rather than hiding it inside the rate. See the Fees page for current values.',
  },
  {
    category: 'pricing',
    question: 'Is the exchange rate guaranteed?',
    answer:
      'The rate is locked when you start a transaction and held for a limited window. If the market moves beyond a set tolerance before you authorize payment, the quote is voided and you are shown a fresh one to confirm. You are never charged against a price you did not see.',
  },
  {
    category: 'pricing',
    question: 'Will my bank add its own fee?',
    answer:
      'Possibly. Many card issuers charge a foreign transaction fee on cross-border purchases, and that fee is set by your bank, not by us. We cannot see it and cannot include it in our totals. Check with your issuer.',
  },
  {
    category: 'pickup',
    question: 'What do I need to bring to collect my pesos?',
    answer:
      'Your pickup code and a valid government-issued photo identification — passport, national ID card, or driver license. The agent must verify both. A code alone is never enough.',
  },
  {
    category: 'pickup',
    question: 'How long is my pickup code valid?',
    answer:
      'Thirty days by default. The exact expiry is shown with your code and in your transaction history. If a code expires uncollected, the transaction is refunded.',
  },
  {
    category: 'pickup',
    question: 'Can someone else collect the cash for me?',
    answer:
      'No. The identity check at the window is against the person who created the transaction. This is deliberate — it is one of the main controls preventing a stolen code from being cashed out.',
  },
  {
    category: 'pickup',
    question: 'What if I lose my pickup code?',
    answer:
      'Contact support. For security, the code is shown once and is not stored in a form we can read back to you, so recovering a transaction requires identity verification and issuing a new credential.',
  },
  {
    category: 'security',
    question: 'Do you store my card number?',
    answer:
      'No. Card details go directly from your browser to a payment provider using their hosted fields. Your card number, expiry date, and security code never reach our servers or our database. We hold only an opaque token, the card brand, and the last four digits.',
  },
  {
    category: 'security',
    question: 'What stops someone guessing a pickup code?',
    answer:
      'Codes are generated with cryptographic randomness from a keyspace of over a trillion combinations, stored only as a hash, limited to a small number of verification attempts before locking, and paired with an identity check at the counter. Failed attempts raise fraud alerts.',
  },
  {
    category: 'compliance',
    question: 'Why do you ask for identity documents?',
    answer:
      'Anti-money-laundering and know-your-customer obligations apply to any business handling cash payouts at scale, and identity verification is also the main control preventing a stolen card from funding an irreversible cash disbursement. In this demonstration no document is actually verified.',
  },
  {
    category: 'compliance',
    question: 'Are there limits?',
    answer:
      'Yes — per transaction, per day, and per month. The limits in this demonstration are arbitrary engineering defaults, not Dominican legal thresholds. Real limits would be set with qualified legal counsel and the licensed partner.',
  },
  {
    category: 'compliance',
    question: 'Why was my transaction put under review?',
    answer:
      'Transactions that score above a risk threshold are held automatically for a human to look at. Reviews protect both you and the platform. If your transaction is held, you are notified and it is examined by a compliance analyst.',
  },
];

const ES: FaqItem[] = [
  {
    category: 'general',
    question: '¿Larimar es un servicio financiero real que puedo usar hoy?',
    answer:
      'No. Larimar es una demostración técnica. No es un transmisor de dinero, institución de pago ni agente de cambio autorizado en ningún lugar. No procesa dinero real, no custodia fondos de clientes y no tiene acuerdos con ningún banco ni institución pagadora. Todas las ubicaciones mostradas son ficticias.',
  },
  {
    category: 'general',
    question: '¿Cómo funciona?',
    answer:
      'Ingresas la cantidad de pesos dominicanos que deseas recibir. Te mostramos la tasa de cambio, cada tarifa y el total exacto que se cobraría a tu tarjeta. Después del pago recibes un código de retiro. Llevas ese código y una identificación oficial a una ubicación autorizada, y el agente verifica ambos antes de entregarte el efectivo.',
  },
  {
    category: 'general',
    question: '¿Por qué no simplemente usar un cajero automático?',
    answer:
      'Puedes hacerlo, y a veces deberías. El argumento a favor de este método es que reemplaza varios usos físicos de la tarjeta por un solo pago en línea desde tu propio dispositivo, a un precio que ves completo de antemano. Cada uso físico de una tarjeta extranjera en una terminal desconocida es otra oportunidad de clonación.',
  },
  {
    category: 'pricing',
    question: '¿Cuánto cuesta?',
    answer:
      'Tres componentes, todos mostrados antes de pagar: una tarifa de plataforma, una tarifa de procesamiento cobrada por el procesador de tarjetas y un margen de tasa de cambio. Mostramos el margen como una línea separada en lugar de ocultarlo dentro de la tasa. Consulta la página de Tarifas para ver los valores actuales.',
  },
  {
    category: 'pricing',
    question: '¿La tasa de cambio está garantizada?',
    answer:
      'La tasa se fija cuando inicias una transacción y se mantiene por un tiempo limitado. Si el mercado se mueve más allá de una tolerancia establecida antes de que autorices el pago, la cotización se anula y se te muestra una nueva para confirmar. Nunca se te cobra a un precio que no viste.',
  },
  {
    category: 'pricing',
    question: '¿Mi banco agregará su propia tarifa?',
    answer:
      'Es posible. Muchos emisores cobran una comisión por transacción internacional, y esa comisión la establece tu banco, no nosotros. No podemos verla ni incluirla en nuestros totales. Consulta con tu emisor.',
  },
  {
    category: 'pickup',
    question: '¿Qué necesito llevar para recoger mis pesos?',
    answer:
      'Tu código de retiro y una identificación oficial con foto vigente — pasaporte, cédula o licencia de conducir. El agente debe verificar ambos. Un código por sí solo nunca es suficiente.',
  },
  {
    category: 'pickup',
    question: '¿Cuánto tiempo es válido mi código de retiro?',
    answer:
      'Treinta días por defecto. La fecha exacta de vencimiento se muestra con tu código y en tu historial. Si un código vence sin ser cobrado, la transacción se reembolsa.',
  },
  {
    category: 'pickup',
    question: '¿Puede otra persona recoger el efectivo por mí?',
    answer:
      'No. La verificación de identidad en el mostrador es contra la persona que creó la transacción. Esto es deliberado: es uno de los controles principales que impide que un código robado sea cobrado.',
  },
  {
    category: 'pickup',
    question: '¿Qué pasa si pierdo mi código de retiro?',
    answer:
      'Contacta a soporte. Por seguridad, el código se muestra una sola vez y no se almacena de forma que podamos leerlo de vuelta, así que recuperar una transacción requiere verificación de identidad y emitir una nueva credencial.',
  },
  {
    category: 'security',
    question: '¿Almacenan el número de mi tarjeta?',
    answer:
      'No. Los datos de la tarjeta van directamente de tu navegador al proveedor de pagos mediante sus campos alojados. El número, la fecha de vencimiento y el código de seguridad nunca llegan a nuestros servidores ni a nuestra base de datos. Solo conservamos un token opaco, la marca de la tarjeta y los últimos cuatro dígitos.',
  },
  {
    category: 'security',
    question: '¿Qué impide que alguien adivine un código de retiro?',
    answer:
      'Los códigos se generan con aleatoriedad criptográfica desde un espacio de más de un billón de combinaciones, se almacenan solo como hash, tienen un número limitado de intentos antes de bloquearse y se combinan con una verificación de identidad en el mostrador. Los intentos fallidos generan alertas de fraude.',
  },
  {
    category: 'compliance',
    question: '¿Por qué piden documentos de identidad?',
    answer:
      'Las obligaciones de prevención de lavado de activos y conocimiento del cliente aplican a cualquier negocio que maneje entregas de efectivo a escala, y la verificación de identidad es también el control principal que impide que una tarjeta robada financie una entrega irreversible de efectivo. En esta demostración ningún documento se verifica realmente.',
  },
  {
    category: 'compliance',
    question: '¿Hay límites?',
    answer:
      'Sí — por transacción, por día y por mes. Los límites de esta demostración son valores arbitrarios de ingeniería, no umbrales legales dominicanos. Los límites reales se establecerían con asesoría legal calificada y el socio autorizado.',
  },
  {
    category: 'compliance',
    question: '¿Por qué mi transacción quedó en revisión?',
    answer:
      'Las transacciones que superan un umbral de riesgo se retienen automáticamente para que una persona las revise. Las revisiones te protegen a ti y a la plataforma. Si tu transacción queda retenida, se te notifica y un analista de cumplimiento la examina.',
  },
];

export const FAQ_ITEMS: Readonly<Record<Locale, readonly FaqItem[]>> = Object.freeze({
  en: EN,
  es: ES,
});

export const FAQ_CATEGORY_LABELS: Readonly<
  Record<Locale, Record<FaqItem['category'], string>>
> = Object.freeze({
  en: {
    general: 'General',
    pricing: 'Pricing',
    pickup: 'Collecting your cash',
    security: 'Security',
    compliance: 'Compliance',
  },
  es: {
    general: 'General',
    pricing: 'Precios',
    pickup: 'Recoger tu efectivo',
    security: 'Seguridad',
    compliance: 'Cumplimiento',
  },
});
