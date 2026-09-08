/**
 * Legal page content, bilingual.
 *
 * These are DEMONSTRATION documents. They are written to describe this build
 * honestly rather than to be enforceable instruments, and every one of them
 * opens by saying so. Real terms, a real privacy notice, and a real AML
 * disclosure must be drafted by qualified counsel in the relevant jurisdiction
 * before anything here is used commercially.
 */

import type { Locale } from '@/i18n/config';

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
}

export interface LegalDocument {
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
}

type DocumentKey = 'terms' | 'privacy' | 'aml';

const EN: Record<DocumentKey, LegalDocument> = {
  terms: {
    title: 'Terms of Service',
    intro:
      'These are demonstration terms for a technical prototype. Larimar is not a licensed financial institution and provides no financial service. Nothing here creates a commercial relationship or an enforceable obligation.',
    sections: [
      {
        heading: '1. What this service is',
        paragraphs: [
          'Larimar is a software demonstration of a cash-pickup platform. It simulates the process of funding a transaction with a payment card and collecting cash at a payout location.',
          'No real money moves. No card is charged. No cash is disbursed. Every payout location shown is fictional and no institution named or implied is a partner.',
        ],
      },
      {
        heading: '2. Eligibility',
        paragraphs: [
          'In a real deployment, use would be restricted to individuals of legal age in their jurisdiction who successfully complete identity verification and sanctions screening. In this demonstration, no such verification actually occurs.',
        ],
      },
      {
        heading: '3. Pricing and disclosure',
        paragraphs: [
          'The platform is designed so that the exchange rate, platform fee, payment processing fee, and exchange rate margin are all disclosed as separate line items before any authorization.',
          'Prices are locked for a limited window. If the underlying rate moves beyond tolerance before authorization, the quote is void and a fresh one must be confirmed.',
        ],
      },
      {
        heading: '4. Pickup credentials',
        paragraphs: [
          'A pickup code is designed to function as a bearer credential combined with an identity check. A code alone does not entitle the holder to funds; a matching government-issued identity document is also required.',
        ],
        bullets: [
          'Codes expire after a defined period.',
          'Codes may be redeemed once only.',
          'Verification attempts are limited; exceeding the limit locks the code.',
          'A code must be treated with the care appropriate to cash.',
        ],
      },
      {
        heading: '5. Prohibited use',
        paragraphs: [
          'Do not submit real payment card details, real identity documents, or passwords used on other services to this demonstration.',
          'Do not represent this software to any third party as an operating financial service.',
        ],
      },
      {
        heading: '6. No warranty',
        paragraphs: [
          'This software is provided as a demonstration, without warranty of any kind, express or implied. It is not fit for handling real customer funds.',
        ],
      },
      {
        heading: '7. Changes',
        paragraphs: [
          'These demonstration terms may change at any time without notice, because they govern nothing.',
        ],
      },
    ],
  },

  privacy: {
    title: 'Privacy Policy',
    intro:
      'This describes how the demonstration handles data. It is not a compliant privacy notice under any specific data-protection regime and must be replaced before commercial use.',
    sections: [
      {
        heading: '1. What we do not collect',
        paragraphs: [
          'Card numbers, expiry dates, and security codes never reach this application. Card details are exchanged directly between the browser and a payment provider, and only an opaque token, the card brand, and the last four digits are retained.',
          'Full identity document numbers are not stored. Only the last four characters are retained after a verification attempt.',
        ],
      },
      {
        heading: '2. What is collected',
        paragraphs: ['In this demonstration, the following is stored in a demonstration database:'],
        bullets: [
          'Account details: email address, name, chosen language, hashed password.',
          'Transaction records: amounts, currencies, fees, exchange rates, status history.',
          'Verification records: document type, issuing country, last four characters, screening outcome.',
          'Technical data: IP address, user agent, device fingerprint, session metadata.',
          'Audit records of privileged actions.',
        ],
      },
      {
        heading: '3. Why it is collected',
        paragraphs: [
          'To operate the demonstration, to demonstrate anti-fraud and compliance controls, and to produce an auditable record of every state change.',
        ],
      },
      {
        heading: '4. Retention and deletion',
        paragraphs: [
          'Financial and audit records in a real deployment are typically subject to statutory retention periods that override deletion requests. In this demonstration, data persists until the database is reset.',
        ],
      },
      {
        heading: '5. Sharing',
        paragraphs: [
          'Nothing is shared. All external providers in this build are simulated and no data leaves the local environment.',
        ],
      },
      {
        heading: '6. Your choices',
        paragraphs: [
          'Do not enter real personal data into a demonstration environment. That is the most effective privacy control available to you here.',
        ],
      },
    ],
  },

  aml: {
    title: 'AML and KYC disclosure',
    intro:
      'This describes the anti-money-laundering and know-your-customer controls the platform implements architecturally. None of them are operational compliance controls, because there is no licensed entity operating them.',
    sections: [
      {
        heading: '1. Why these controls exist',
        paragraphs: [
          'Cash payout is a high-risk activity. A stolen payment card can fund an irreversible disbursement to a stranger, and cash is attractive to money laundering. Any real deployment requires a formal compliance programme.',
        ],
      },
      {
        heading: '2. Identity verification',
        paragraphs: [
          'The platform requires identity verification above a configurable amount and before any payout. In this demonstration, verification is simulated: no document is authenticated and no biometric check occurs.',
        ],
      },
      {
        heading: '3. Screening',
        paragraphs: [
          'The architecture includes sanctions and politically-exposed-person screening at verification. In this demonstration, screening matches against a short fixture list of obviously fictional names. It is a wiring test, not screening.',
        ],
      },
      {
        heading: '4. Transaction monitoring',
        paragraphs: [
          'Every transaction is scored against configurable rules covering amount, limits, velocity, account age, device reuse, geography, and prior chargeback history. Scores above a threshold are held automatically for human review.',
        ],
      },
      {
        heading: '5. Limits',
        paragraphs: [
          'Per-transaction, daily, and monthly limits are enforced server-side. The values shipped in this demonstration are arbitrary engineering defaults. They are not Dominican legal thresholds and must not be represented as such.',
        ],
      },
      {
        heading: '6. Suspicious activity',
        paragraphs: [
          'The system can flag a case as reportable and records that flag. Actually filing a suspicious activity report requires a licensed entity, a designated compliance officer, and a reporting channel — none of which exist here.',
        ],
      },
      {
        heading: '7. Record keeping',
        paragraphs: [
          'Every state change, privileged action, payout, and ledger posting is recorded in an append-only form designed to support audit and investigation.',
        ],
      },
    ],
  },
};

const ES: Record<DocumentKey, LegalDocument> = {
  terms: {
    title: 'Términos de Servicio',
    intro:
      'Estos son términos de demostración para un prototipo técnico. Larimar no es una institución financiera autorizada y no presta ningún servicio financiero. Nada aquí crea una relación comercial ni una obligación exigible.',
    sections: [
      {
        heading: '1. Qué es este servicio',
        paragraphs: [
          'Larimar es una demostración de software de una plataforma de retiro de efectivo. Simula el proceso de financiar una transacción con una tarjeta de pago y recoger efectivo en una ubicación pagadora.',
          'No se mueve dinero real. No se cobra ninguna tarjeta. No se entrega efectivo. Todas las ubicaciones mostradas son ficticias y ninguna institución nombrada o implicada es un socio.',
        ],
      },
      {
        heading: '2. Elegibilidad',
        paragraphs: [
          'En un despliegue real, el uso estaría restringido a personas mayores de edad en su jurisdicción que completen verificación de identidad y filtrado de sanciones. En esta demostración, tal verificación no ocurre realmente.',
        ],
      },
      {
        heading: '3. Precios y divulgación',
        paragraphs: [
          'La plataforma está diseñada para que la tasa de cambio, la tarifa de plataforma, la tarifa de procesamiento y el margen de tasa se divulguen como líneas separadas antes de cualquier autorización.',
          'Los precios se fijan por un tiempo limitado. Si la tasa se mueve más allá de la tolerancia antes de la autorización, la cotización se anula y debe confirmarse una nueva.',
        ],
      },
      {
        heading: '4. Credenciales de retiro',
        paragraphs: [
          'Un código de retiro funciona como credencial al portador combinada con una verificación de identidad. Un código por sí solo no da derecho a los fondos; también se requiere un documento de identidad oficial que coincida.',
        ],
        bullets: [
          'Los códigos vencen tras un período definido.',
          'Los códigos solo pueden usarse una vez.',
          'Los intentos de verificación son limitados; superarlos bloquea el código.',
          'Un código debe tratarse con el cuidado que corresponde al efectivo.',
        ],
      },
      {
        heading: '5. Uso prohibido',
        paragraphs: [
          'No envíes datos reales de tarjetas, documentos de identidad reales ni contraseñas usadas en otros servicios a esta demostración.',
          'No presentes este software a terceros como un servicio financiero en funcionamiento.',
        ],
      },
      {
        heading: '6. Sin garantía',
        paragraphs: [
          'Este software se proporciona como demostración, sin garantía de ningún tipo, expresa o implícita. No es apto para manejar fondos reales de clientes.',
        ],
      },
      {
        heading: '7. Cambios',
        paragraphs: [
          'Estos términos de demostración pueden cambiar en cualquier momento sin aviso, porque no rigen nada.',
        ],
      },
    ],
  },

  privacy: {
    title: 'Política de Privacidad',
    intro:
      'Esto describe cómo la demostración maneja los datos. No es un aviso de privacidad conforme a ningún régimen específico de protección de datos y debe reemplazarse antes de cualquier uso comercial.',
    sections: [
      {
        heading: '1. Lo que no recopilamos',
        paragraphs: [
          'Los números de tarjeta, fechas de vencimiento y códigos de seguridad nunca llegan a esta aplicación. Los datos de la tarjeta se intercambian directamente entre el navegador y el proveedor de pagos, y solo se conserva un token opaco, la marca y los últimos cuatro dígitos.',
          'Los números completos de documentos de identidad no se almacenan. Solo se conservan los últimos cuatro caracteres tras un intento de verificación.',
        ],
      },
      {
        heading: '2. Lo que se recopila',
        paragraphs: ['En esta demostración, lo siguiente se guarda en una base de datos de demostración:'],
        bullets: [
          'Datos de cuenta: correo, nombre, idioma elegido, contraseña protegida con hash.',
          'Registros de transacciones: montos, monedas, tarifas, tasas, historial de estado.',
          'Registros de verificación: tipo de documento, país emisor, últimos cuatro caracteres, resultado del filtrado.',
          'Datos técnicos: dirección IP, agente de usuario, huella de dispositivo, metadatos de sesión.',
          'Registros de auditoría de acciones privilegiadas.',
        ],
      },
      {
        heading: '3. Por qué se recopila',
        paragraphs: [
          'Para operar la demostración, mostrar los controles antifraude y de cumplimiento, y producir un registro auditable de cada cambio de estado.',
        ],
      },
      {
        heading: '4. Conservación y eliminación',
        paragraphs: [
          'En un despliegue real, los registros financieros y de auditoría suelen estar sujetos a plazos legales de conservación que prevalecen sobre solicitudes de eliminación. En esta demostración, los datos persisten hasta que se reinicia la base de datos.',
        ],
      },
      {
        heading: '5. Compartición',
        paragraphs: [
          'No se comparte nada. Todos los proveedores externos en esta versión son simulados y ningún dato sale del entorno local.',
        ],
      },
      {
        heading: '6. Tus opciones',
        paragraphs: [
          'No ingreses datos personales reales en un entorno de demostración. Es el control de privacidad más eficaz disponible para ti aquí.',
        ],
      },
    ],
  },

  aml: {
    title: 'Declaración de PLD y KYC',
    intro:
      'Esto describe los controles de prevención de lavado de activos y conocimiento del cliente que la plataforma implementa a nivel de arquitectura. Ninguno es un control de cumplimiento operativo, porque no hay una entidad autorizada operándolos.',
    sections: [
      {
        heading: '1. Por qué existen estos controles',
        paragraphs: [
          'La entrega de efectivo es una actividad de alto riesgo. Una tarjeta robada puede financiar una entrega irreversible a un desconocido, y el efectivo es atractivo para el lavado de activos. Cualquier despliegue real requiere un programa formal de cumplimiento.',
        ],
      },
      {
        heading: '2. Verificación de identidad',
        paragraphs: [
          'La plataforma requiere verificación de identidad por encima de un monto configurable y antes de cualquier entrega. En esta demostración la verificación es simulada: ningún documento se autentica y no hay verificación biométrica.',
        ],
      },
      {
        heading: '3. Filtrado',
        paragraphs: [
          'La arquitectura incluye filtrado de sanciones y personas expuestas políticamente durante la verificación. En esta demostración, el filtrado compara contra una lista corta de nombres obviamente ficticios. Es una prueba de conexión, no un filtrado real.',
        ],
      },
      {
        heading: '4. Monitoreo de transacciones',
        paragraphs: [
          'Cada transacción se puntúa contra reglas configurables que cubren monto, límites, velocidad, antigüedad de la cuenta, reutilización de dispositivos, geografía e historial de contracargos. Las puntuaciones sobre el umbral se retienen automáticamente para revisión humana.',
        ],
      },
      {
        heading: '5. Límites',
        paragraphs: [
          'Los límites por transacción, diarios y mensuales se aplican del lado del servidor. Los valores incluidos en esta demostración son valores arbitrarios de ingeniería. No son umbrales legales dominicanos y no deben presentarse como tales.',
        ],
      },
      {
        heading: '6. Actividad sospechosa',
        paragraphs: [
          'El sistema puede marcar un caso como reportable y registra esa marca. Presentar un reporte de operación sospechosa requiere una entidad autorizada, un oficial de cumplimiento designado y un canal de reporte, ninguno de los cuales existe aquí.',
        ],
      },
      {
        heading: '7. Conservación de registros',
        paragraphs: [
          'Cada cambio de estado, acción privilegiada, entrega y asiento contable se registra en forma solo-agregable, diseñada para soportar auditoría e investigación.',
        ],
      },
    ],
  },
};

export const LEGAL_DOCUMENTS: Readonly<Record<Locale, Record<DocumentKey, LegalDocument>>> =
  Object.freeze({ en: EN, es: ES });

export type { DocumentKey };
