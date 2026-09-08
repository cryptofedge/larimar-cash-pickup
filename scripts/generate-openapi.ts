/**
 * OpenAPI 3.1 generation.
 *
 * Request schemas are derived from the same Zod objects the route handlers parse
 * with, so the specification cannot drift from the implementation. A hand-written
 * spec would be wrong within a week; this one is wrong only if the code is.
 *
 *   npm run openapi   ->  public/openapi.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import {
  adminSearchSchema,
  cancelTransactionSchema,
  completePasswordResetSchema,
  complianceReviewSchema,
  confirmPaymentSchema,
  createTransactionSchema,
  listLocationsSchema,
  loginSchema,
  quoteRequestSchema,
  redeemPickupSchema,
  registerSchema,
  rejectPickupSchema,
  requestPasswordResetSchema,
  submitKycSchema,
  supportTicketSchema,
  verifyPickupSchema,
} from '../src/lib/validation/schemas';

type JsonSchema = Record<string, unknown>;

/**
 * A small Zod -> JSON Schema converter covering exactly the constructs this API
 * uses. Deliberately not a general-purpose library: a narrow converter that
 * throws on anything unfamiliar is safer than a broad one that silently emits
 * `{}` for a type it does not understand.
 */
function toJsonSchema(schema: z.ZodTypeAny, depth = 0): JsonSchema {
  if (depth > 12) return {};

  const def = schema._def as { typeName?: string } & Record<string, unknown>;

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const field = value as z.ZodTypeAny;
        properties[key] = toJsonSchema(field, depth + 1);
        if (!field.isOptional()) required.push(key);
      }

      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      };
    }

    case 'ZodString': {
      const checks = (def.checks ?? []) as { kind: string; value?: number; regex?: RegExp }[];
      const out: JsonSchema = { type: 'string' };
      for (const check of checks) {
        if (check.kind === 'min') out.minLength = check.value;
        if (check.kind === 'max') out.maxLength = check.value;
        if (check.kind === 'email') out.format = 'email';
        if (check.kind === 'uuid') out.format = 'uuid';
        if (check.kind === 'datetime') out.format = 'date-time';
        if (check.kind === 'regex' && check.regex) out.pattern = check.regex.source;
        if (check.kind === 'length') {
          out.minLength = check.value;
          out.maxLength = check.value;
        }
      }
      return out;
    }

    case 'ZodNumber': {
      const checks = (def.checks ?? []) as { kind: string; value?: number }[];
      const out: JsonSchema = { type: 'number' };
      for (const check of checks) {
        if (check.kind === 'int') out.type = 'integer';
        if (check.kind === 'min') out.minimum = check.value;
        if (check.kind === 'max') out.maximum = check.value;
      }
      return out;
    }

    case 'ZodBoolean':
      return { type: 'boolean' };

    case 'ZodEnum':
      return { type: 'string', enum: def.values as string[] };

    case 'ZodLiteral':
      return { const: def.value };

    case 'ZodArray':
      return { type: 'array', items: toJsonSchema(def.type as z.ZodTypeAny, depth + 1) };

    case 'ZodRecord':
      return { type: 'object', additionalProperties: true };

    case 'ZodUnion':
      return {
        anyOf: (def.options as z.ZodTypeAny[]).map((option) => toJsonSchema(option, depth + 1)),
      };

    case 'ZodOptional':
      return toJsonSchema(def.innerType as z.ZodTypeAny, depth + 1);

    case 'ZodNullable': {
      const inner = toJsonSchema(def.innerType as z.ZodTypeAny, depth + 1);
      return { anyOf: [inner, { type: 'null' }] };
    }

    case 'ZodDefault': {
      const inner = toJsonSchema(def.innerType as z.ZodTypeAny, depth + 1);
      const defaultValue = (def.defaultValue as () => unknown)();
      return { ...inner, default: defaultValue };
    }

    case 'ZodEffects':
      return toJsonSchema(def.schema as z.ZodTypeAny, depth + 1);

    case 'ZodUnknown':
    case 'ZodAny':
      return {};

    default:
      throw new Error(
        `Unhandled Zod type "${String(def.typeName)}" in the OpenAPI converter. ` +
          'Add a case rather than letting the spec silently lose a constraint.',
      );
  }
}

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { path: { type: 'string' }, message: { type: 'string' } },
                },
              },
            },
            required: ['code', 'message'],
          },
        },
      },
    },
  },
};

function operation(input: {
  summary: string;
  description: string;
  tag: string;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  security?: 'session' | 'partner' | 'webhook' | 'none';
  permission?: string;
  idempotent?: boolean;
  responseDescription?: string;
}) {
  const parameters: JsonSchema[] = [];

  if (input.query) {
    const querySchema = toJsonSchema(input.query) as {
      properties?: Record<string, JsonSchema>;
      required?: string[];
    };
    for (const [name, schema] of Object.entries(querySchema.properties ?? {})) {
      parameters.push({
        name,
        in: 'query',
        required: (querySchema.required ?? []).includes(name),
        schema,
      });
    }
  }

  if (input.idempotent) {
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      description:
        'A client-generated unique key. Replaying the same key with the same body returns the stored original response; a different body returns 409.',
      schema: { type: 'string', minLength: 8, maxLength: 200 },
    });
  }

  const securitySchemes: Record<string, unknown[]> = {
    session: [{ sessionCookie: [] }],
    partner: [{ partnerSignature: [] }],
    webhook: [],
    none: [],
  };

  return {
    summary: input.summary,
    description:
      input.description +
      (input.permission ? `\n\n**Required permission:** \`${input.permission}\`` : ''),
    tags: [input.tag],
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(input.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: toJsonSchema(input.body) } },
          },
        }
      : {}),
    ...(input.security && input.security !== 'none'
      ? { security: securitySchemes[input.security] }
      : { security: [] }),
    responses: {
      '200': { description: input.responseDescription ?? 'Success' },
      '201': { description: 'Created' },
      '400': errorResponse,
      '401': errorResponse,
      '403': errorResponse,
      '409': errorResponse,
      '422': errorResponse,
      '429': errorResponse,
    },
  };
}

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Larimar API',
    version: '0.1.0',
    description: [
      'Cash pickup platform API.',
      '',
      '**This is a demonstration.** Larimar is not a licensed money transmitter,',
      'payment institution, or foreign exchange dealer. Every external financial',
      'provider is simulated and no real money moves.',
      '',
      '### Conventions',
      '',
      '- All monetary values are **strings** containing integer minor units',
      '  (`"2000000"` is RD$20,000.00). They are strings, not numbers, because',
      '  JSON numbers are IEEE-754 doubles and would lose precision.',
      '- Exchange rates are decimal strings.',
      '- Every mutating financial endpoint requires an `Idempotency-Key` header.',
      '- Errors share one shape: `{ "error": { "code", "message" } }`.',
    ].join('\n'),
    license: { name: 'MIT' },
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  tags: [
    { name: 'Authentication', description: 'Registration, login, sessions, password reset' },
    { name: 'Pricing', description: 'Exchange rates and quotes' },
    { name: 'Transactions', description: 'Creating and managing cash pickup transactions' },
    { name: 'Payments', description: 'Payment intents and confirmation' },
    { name: 'Identity', description: 'KYC submission' },
    { name: 'Pickup', description: 'Payout window operations' },
    { name: 'Compliance', description: 'Holds, releases, and case management' },
    { name: 'Admin', description: 'Metrics and search' },
    { name: 'Support', description: 'Support tickets' },
    { name: 'Webhooks', description: 'Provider callbacks' },
    { name: 'Partner API', description: 'Server-to-server API for payout institutions' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'larimar_session',
        description:
          'Opaque session token in an HttpOnly cookie. Stored hashed server-side and revocable immediately.',
      },
      partnerSignature: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Larimar-Signature',
        description: [
          'HMAC-SHA256 over `METHOD\\nPATH\\nTIMESTAMP\\nSHA256(body)`.',
          'Send `X-Larimar-Key-Id`, `X-Larimar-Timestamp`, and `X-Larimar-Signature`.',
          'Requests outside the timestamp tolerance are rejected as replays.',
        ].join(' '),
      },
    },
  },
  paths: {
    '/api/auth/register': {
      post: operation({
        summary: 'Create an account',
        description:
          'Responds identically whether or not the address was already registered, so this endpoint cannot be used to enumerate customers.',
        tag: 'Authentication',
        body: registerSchema,
        security: 'none',
      }),
    },
    '/api/auth/login': {
      post: operation({
        summary: 'Sign in',
        description:
          'Returns 401 with the same code for an unknown account and a wrong password. Staff roles require a TOTP code.',
        tag: 'Authentication',
        body: loginSchema,
        security: 'none',
      }),
    },
    '/api/auth/logout': {
      post: operation({
        summary: 'Sign out',
        description: 'Revokes the current session server-side.',
        tag: 'Authentication',
        security: 'session',
        permission: 'profile.read.own',
      }),
    },
    '/api/auth/password-reset': {
      post: operation({
        summary: 'Request a password reset',
        description: 'Always reports success. Reveals nothing about whether the address exists.',
        tag: 'Authentication',
        body: requestPasswordResetSchema,
        security: 'none',
      }),
      put: operation({
        summary: 'Complete a password reset',
        description: 'Revokes every existing session for the account on success.',
        tag: 'Authentication',
        body: completePasswordResetSchema,
        security: 'none',
      }),
    },
    '/api/me': {
      get: operation({
        summary: 'Current user and limits',
        description: 'Profile, roles, KYC level, and remaining daily/monthly limits.',
        tag: 'Authentication',
        security: 'session',
        permission: 'profile.read.own',
      }),
    },
    '/api/exchange-rates': {
      get: operation({
        summary: 'Current rate for a corridor',
        description:
          'Public. Every response carries `isDemoRate`, which is true whenever the mock provider is installed.',
        tag: 'Pricing',
        security: 'none',
      }),
      post: operation({
        summary: 'Price a specific amount',
        description:
          'Server-computed and not persisted. Returns the full itemised breakdown including the FX spread as its own line.',
        tag: 'Pricing',
        body: quoteRequestSchema,
        security: 'none',
      }),
    },
    '/api/transactions': {
      post: operation({
        summary: 'Create a transaction',
        description:
          'The client supplies only the amount, country, funding currency, and preferred location. Price, risk score, limits, and the resulting status are all determined server-side.',
        tag: 'Transactions',
        body: createTransactionSchema,
        security: 'session',
        permission: 'transaction.create',
        idempotent: true,
      }),
      get: operation({
        summary: 'List own transactions',
        description: 'Paginated, newest first.',
        tag: 'Transactions',
        security: 'session',
        permission: 'transaction.read.own',
      }),
    },
    '/api/transactions/{id}': {
      get: operation({
        summary: 'Transaction detail',
        description:
          'Full receipt, location, payment summary, and status timeline. Ledger detail is included only for principals holding `ledger.read`.',
        tag: 'Transactions',
        security: 'session',
        permission: 'transaction.read.own',
      }),
    },
    '/api/transactions/{id}/cancel': {
      post: operation({
        summary: 'Cancel a transaction',
        description: 'Permitted only before funding.',
        tag: 'Transactions',
        body: cancelTransactionSchema,
        security: 'session',
        permission: 'transaction.cancel.own',
      }),
    },
    '/api/transactions/{id}/payment': {
      post: operation({
        summary: 'Create a payment intent',
        description:
          'Returns a client secret for the provider hosted fields. Reuses an existing open intent rather than creating a second charge.',
        tag: 'Payments',
        security: 'session',
        permission: 'transaction.create',
        idempotent: true,
      }),
      put: operation({
        summary: 'Confirm payment',
        description:
          'Re-validates the quote, authorises, captures, posts the ledger, and issues the pickup credential. The plaintext pickup code is returned here and **nowhere else, ever**.',
        tag: 'Payments',
        body: confirmPaymentSchema,
        security: 'session',
        permission: 'transaction.create',
        idempotent: true,
      }),
    },
    '/api/transactions/{id}/pickup': {
      get: operation({
        summary: 'Pickup credential status',
        description:
          'Status, expiry, and remaining attempts. Deliberately does NOT return the code — it is not stored in a recoverable form.',
        tag: 'Pickup',
        security: 'session',
        permission: 'pickup.code.view.own',
      }),
    },
    '/api/kyc': {
      post: operation({
        summary: 'Submit identity documents',
        description:
          'The document number is passed to the provider and discarded; only the last four characters are persisted.',
        tag: 'Identity',
        body: submitKycSchema,
        security: 'session',
        permission: 'kyc.submit.own',
        idempotent: true,
      }),
    },
    '/api/pickup/locations': {
      get: operation({
        summary: 'Pickup location directory',
        description:
          'Public. Every location carries `isDemo` and, when true, a `demoNotice` that clients must display.',
        tag: 'Pickup',
        query: listLocationsSchema,
        security: 'none',
      }),
    },
    '/api/pickup/verify': {
      post: operation({
        summary: 'Verify a pickup code',
        description:
          'Returns a deliberately narrow view containing no customer personal data. Burns a verification attempt; repeated failures lock the code and raise a fraud alert.',
        tag: 'Pickup',
        body: verifyPickupSchema,
        security: 'session',
        permission: 'pickup.verify',
      }),
    },
    '/api/pickup/redeem': {
      post: operation({
        summary: 'Disburse cash',
        description:
          'Runs at SERIALIZABLE isolation with a conditional update, so concurrent attempts produce exactly one payout.',
        tag: 'Pickup',
        body: redeemPickupSchema,
        security: 'session',
        permission: 'pickup.redeem',
        idempotent: true,
      }),
    },
    '/api/pickup/reject': {
      post: operation({
        summary: 'Refuse a payout',
        description: 'Records the refusal without changing transaction state.',
        tag: 'Pickup',
        body: rejectPickupSchema,
        security: 'session',
        permission: 'pickup.reject',
      }),
    },
    '/api/pickup/escalate': {
      post: operation({
        summary: 'Escalate to compliance',
        description:
          'Opens a case and moves the transaction to COMPLIANCE_REVIEW, blocking disbursement everywhere.',
        tag: 'Pickup',
        body: rejectPickupSchema,
        security: 'session',
        permission: 'pickup.escalate',
      }),
    },
    '/api/compliance/review': {
      get: operation({
        summary: 'List open compliance cases',
        description: 'Ordered by priority, then age.',
        tag: 'Compliance',
        security: 'session',
        permission: 'compliance.case.read',
      }),
      post: operation({
        summary: 'Hold, release, or reject',
        description:
          'HOLD requires `compliance.hold.place`. RELEASE and REJECT additionally require `compliance.hold.release`, which SYSTEM_ADMIN deliberately does not hold.',
        tag: 'Compliance',
        body: complianceReviewSchema,
        security: 'session',
        permission: 'compliance.hold.place',
      }),
    },
    '/api/admin/metrics': {
      get: operation({
        summary: 'Dashboard metrics',
        description: 'Aggregates, daily series, status and geographic distribution, ledger integrity.',
        tag: 'Admin',
        security: 'session',
        permission: 'admin.dashboard.read',
      }),
    },
    '/api/admin/transactions': {
      get: operation({
        summary: 'Search transactions',
        description:
          'Searches reference, customer email, id, and pickup code. A code is hashed before matching, so the plaintext is never stored or exposed.',
        tag: 'Admin',
        query: adminSearchSchema,
        security: 'session',
        permission: 'transaction.read.any',
      }),
    },
    '/api/support/tickets': {
      post: operation({
        summary: 'Open a support ticket',
        description: 'Public, so a locked-out customer can still reach support.',
        tag: 'Support',
        body: supportTicketSchema,
        security: 'none',
      }),
    },
    '/api/webhooks/payment': {
      post: operation({
        summary: 'Payment provider webhook',
        description:
          'Requires a valid HMAC signature over the raw body and a timestamp inside the tolerance window. Duplicate provider event ids are rejected as replays.',
        tag: 'Webhooks',
        security: 'webhook',
      }),
    },
    '/api/webhooks/kyc': {
      post: operation({
        summary: 'KYC provider webhook',
        description: 'Same signature, timestamp, and replay guards as the payment webhook.',
        tag: 'Webhooks',
        security: 'webhook',
      }),
    },
    '/api/partner/v1/pickup/verify': {
      post: operation({
        summary: 'Partner: verify a pickup code',
        description:
          'Server-to-server. Returns the same narrow, PII-free view the in-house portal receives.',
        tag: 'Partner API',
        security: 'partner',
      }),
    },
    '/api/partner/v1/pickup/redeem': {
      post: operation({
        summary: 'Partner: confirm a cash payout',
        description:
          'Requires an explicit `identityVerified` assertion and the partner own idempotency key. Returns the settlement amount now payable to the partner.',
        tag: 'Partner API',
        security: 'partner',
      }),
    },
    '/api/health': {
      get: operation({
        summary: 'Health check',
        description: 'Database reachability. Reports nothing else by design.',
        tag: 'Admin',
        security: 'none',
      }),
    },
  },
};

mkdirSync('public', { recursive: true });
writeFileSync('public/openapi.json', `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

const pathCount = Object.keys(spec.paths).length;
const operationCount = Object.values(spec.paths).reduce(
  (total, path) => total + Object.keys(path).length,
  0,
);

console.log(`OpenAPI 3.1 written to public/openapi.json`);
console.log(`  ${pathCount} paths, ${operationCount} operations`);
