/**
 * Audit logging.
 *
 * Append-only. There is no update or delete path anywhere in the application.
 * Every privileged action writes a record with actor, subject, address, and
 * outcome, and the redactor below runs on every payload so a secret cannot reach
 * the log even if a caller passes one in by accident.
 */

import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../db';

/** Keys whose values are replaced wholesale, matched case-insensitively. */
const REDACTED_KEYS = [
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'secret',
  'apisecret',
  'clientsecret',
  'pan',
  'cardnumber',
  'cvv',
  'cvc',
  'pin',
  'code',
  'codehash',
  'pickupcode',
  'secrethash',
  'mfasecret',
  'authorization',
  'cookie',
  'documentnumber',
];

const REDACTION = '[REDACTED]';

/**
 * Recursively strip sensitive values.
 *
 * Defence in depth: callers are expected not to pass secrets, and this runs
 * anyway. Depth is capped so a cyclic or pathological object cannot stall a
 * request.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.includes(key.toLowerCase().replace(/[_-]/g, ''))
        ? REDACTION
        : redact(inner, depth + 1);
    }
    return out;
  }

  return value;
}

export interface AuditInput {
  readonly actorId?: string | null;
  /** "system" | "customer" | "agent" | "compliance" | "admin" | "webhook" | "anonymous" */
  readonly actorType: string;
  readonly actorRoles?: readonly string[];
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly metadata?: Record<string, unknown>;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
  readonly success?: boolean;
}

export async function writeAudit(
  input: AuditInput,
  client: PrismaTransactionClient = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorType: input.actorType,
      actorRoles: [...(input.actorRoles ?? [])],
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      before: (redact(input.before) ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (redact(input.after) ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (redact(input.metadata) ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      requestId: input.requestId ?? null,
      success: input.success ?? true,
    },
  });
}

/**
 * Audit a failure.
 *
 * Failed privileged attempts matter more than successful ones for detection: a
 * refused payout approval or a denied admin call is exactly the signal a fraud
 * investigation needs.
 */
export async function writeAuditFailure(
  input: AuditInput & { reason: string },
  client: PrismaTransactionClient = prisma,
): Promise<void> {
  await writeAudit(
    {
      ...input,
      success: false,
      metadata: { ...(input.metadata ?? {}), reason: input.reason },
    },
    client,
  );
}
