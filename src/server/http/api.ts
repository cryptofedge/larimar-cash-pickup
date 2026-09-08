/**
 * The API handler wrapper.
 *
 * Every route goes through this. It applies, in order: request context, rate
 * limiting, authentication, MFA enforcement, authorisation, body validation,
 * idempotency, and a single error translator. A route that forgets one of these
 * is not possible, because a route cannot exist outside the wrapper.
 *
 * Authorisation is deny-by-default: `permission: null` must be stated
 * explicitly for a public route, which makes "this endpoint is intentionally
 * open" a visible decision in the code rather than an omission.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { randomUUID } from 'node:crypto';
import { DomainError, httpStatusForCode, isDomainError } from '@/lib/domain/errors';
import { type Permission, hasPermission } from '../auth/rbac';
import { type Principal, isFullyAuthenticated, resolvePrincipal } from '../auth/session';
import { env } from '../env';
import { checkRateLimit, type RateLimitRule } from './rate-limit';
import { withIdempotency } from './idempotency';
import { writeAuditFailure } from '../services/audit';

export interface RequestContext {
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly principal: Principal | null;
}

export interface HandlerArgs<TBody> {
  readonly req: NextRequest;
  readonly body: TBody;
  readonly ctx: RequestContext;
  readonly params: Record<string, string>;
}

export interface RouteOptions<TBody> {
  /** The permission required. `null` means intentionally public — state it. */
  readonly permission: Permission | null;
  /**
   * Input is deliberately `unknown`: `TBody` is the schema's OUTPUT type, so a
   * schema using `.default()` or `.transform()` gives the handler the parsed
   * shape rather than the raw request shape.
   */
  readonly schema?: ZodType<TBody, ZodTypeDef, unknown>;
  /** Read query parameters instead of a JSON body. */
  readonly source?: 'body' | 'query';
  readonly rateLimit?: RateLimitRule;
  /** Require an Idempotency-Key header and replay-protect this route. */
  readonly idempotent?: boolean;
  readonly auditAction?: string;
}

/** Trusted only behind a proxy that sets it. Used for rate limiting and audit. */
function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

/**
 * Origin check for state-changing requests.
 *
 * Combined with SameSite=Lax cookies this is the CSRF defence. A cross-site form
 * post carries an Origin the server can reject, and a cross-site fetch cannot
 * forge one.
 */
function originAllowed(req: NextRequest): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;

  const origin = req.headers.get('origin');
  if (!origin) {
    // Same-origin fetches from some clients omit Origin; fall back to Referer.
    const referer = req.headers.get('referer');
    if (!referer) return true;
    try {
      return new URL(referer).origin === new URL(env.APP_URL).origin;
    } catch {
      return false;
    }
  }

  try {
    return new URL(origin).origin === new URL(env.APP_URL).origin;
  } catch {
    return false;
  }
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: { code, message, ...(extra ?? {}) } }, { status });
}

/**
 * Translate any thrown value into a safe response.
 *
 * 4xx domain errors carry their message through because they are written for
 * customers. Anything 5xx is replaced with a generic message so an internal
 * detail, a stack trace, or a database error never reaches a client.
 */
function translateError(error: unknown, requestId: string): NextResponse {
  if (isDomainError(error)) {
    const status = httpStatusForCode(error.code);
    if (status >= 500) {
      console.error(`[${requestId}] ${error.code}:`, error.message);
      return jsonError('INTERNAL_ERROR', 'Something went wrong. Please try again.', status);
    }
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...(error.details ?? {}) } },
      { status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields.',
          fields: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 422 },
    );
  }

  console.error(`[${requestId}] Unhandled:`, error);
  return jsonError('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
}

export function defineRoute<TBody = unknown>(
  options: RouteOptions<TBody>,
  handler: (args: HandlerArgs<TBody>) => Promise<NextResponse>,
) {
  // The context parameter is declared non-optional because Next 15's generated
  // route types require it, even for non-dynamic segments (where `params`
  // resolves to an empty object). It is still accessed defensively below.
  return async (
    req: NextRequest,
    context: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    const requestId = randomUUID();
    const ipAddress = clientIp(req);
    const userAgent = req.headers.get('user-agent');

    try {
      if (!originAllowed(req)) {
        return jsonError('FORBIDDEN', 'Cross-origin request refused', 403);
      }

      // --- Authenticate ---------------------------------------------------
      const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
      const principal = await resolvePrincipal(token);

      // --- Rate limit -----------------------------------------------------
      //
      // Deliberately AFTER authentication, because a `perUser` rule needs a user
      // id to bucket by. Running it first meant every authenticated caller
      // shared one bucket keyed on the address — behind a proxy that is one
      // bucket per proxy, and in local development it is a single global bucket
      // for the whole server. Public routes (login, register, quotes) still
      // bucket by address, which is correct for them.
      //
      // The cost is one indexed session lookup before the limit applies. That is
      // acceptable; a genuinely abusive flood is better handled at the edge by a
      // WAF than by application code.
      if (options.rateLimit) {
        const limited = await checkRateLimit(options.rateLimit, {
          ipAddress,
          identifier: req.headers.get('x-larimar-client') ?? null,
          userId: principal?.userId ?? null,
        });
        if (!limited.allowed) {
          return NextResponse.json(
            { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } },
            { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
          );
        }
      }

      // --- Authorise ------------------------------------------------------
      if (options.permission !== null) {
        if (!principal) {
          return jsonError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
        }
        if (!isFullyAuthenticated(principal)) {
          return jsonError('MFA_REQUIRED', 'Two-factor authentication is required.', 401);
        }
        if (!hasPermission(principal.roles, options.permission)) {
          await writeAuditFailure({
            actorId: principal.userId,
            actorType: 'customer',
            actorRoles: principal.roles,
            action: options.auditAction ?? `denied:${options.permission}`,
            resourceType: 'api',
            resourceId: new URL(req.url).pathname,
            reason: `Missing permission ${options.permission}`,
            ipAddress,
            userAgent,
            requestId,
          });
          return jsonError('FORBIDDEN', 'You do not have access to that.', 403);
        }
      }

      // --- Validate -------------------------------------------------------
      let body = {} as TBody;
      if (options.schema) {
        const raw =
          options.source === 'query'
            ? Object.fromEntries(new URL(req.url).searchParams.entries())
            : await req.json().catch(() => ({}));
        body = options.schema.parse(raw);
      }

      const params = context?.params ? await context.params : {};
      const ctx: RequestContext = { requestId, ipAddress, userAgent, principal };

      // --- Idempotency ----------------------------------------------------
      if (options.idempotent) {
        const key = req.headers.get('idempotency-key');
        if (!key) {
          return jsonError(
            'VALIDATION_ERROR',
            'This endpoint requires an Idempotency-Key header.',
            400,
          );
        }
        return await withIdempotency(
          {
            key,
            scope: `${req.method}:${new URL(req.url).pathname}`,
            userId: principal?.userId ?? null,
            body: body as unknown,
          },
          () => handler({ req, body, ctx, params }),
        );
      }

      return await handler({ req, body, ctx, params });
    } catch (error) {
      return translateError(error, requestId);
    }
  };
}

/** Consistent success envelope. BigInt is serialised as a string, never a number. */
export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(JSON.parse(serialize(data)), { status });
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) =>
    typeof val === 'bigint' ? val.toString() : val,
  );
}

export function requirePrincipal(ctx: RequestContext): Principal {
  if (!ctx.principal) {
    throw new DomainError('UNAUTHENTICATED', 'Please sign in to continue.');
  }
  return ctx.principal;
}
