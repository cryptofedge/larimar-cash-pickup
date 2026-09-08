/**
 * Idempotency.
 *
 * A customer on hotel Wi-Fi taps "Confirm & Pay", the response is lost, they tap
 * again. Without this, that is two charges and two pickup codes. With it, the
 * second request returns the first response.
 *
 * The rules:
 *   - Same key, same body  -> the stored original response.
 *   - Same key, different body -> 409. The key is a promise about the request,
 *     and reusing it for different content is a client bug worth surfacing.
 *   - Same key, still running -> 409 with a retry hint, rather than executing twice.
 *
 * The unique constraint on (scope, key) is what makes the reservation atomic;
 * this code merely interprets the constraint violation.
 */

import { NextResponse } from 'next/server';
import { prisma, isUniqueViolation } from '../db';
import { sha256Hex } from '../auth/crypto';

const RETENTION_HOURS = 24;

export interface IdempotencyInput {
  readonly key: string;
  readonly scope: string;
  readonly userId: string | null;
  readonly body: unknown;
}

function canonicalHash(body: unknown): string {
  // Sort keys so `{a:1,b:2}` and `{b:2,a:1}` are the same request.
  const canonical = JSON.stringify(body, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return typeof v === 'bigint' ? v.toString() : v;
  });
  return sha256Hex(canonical ?? 'null');
}

export async function withIdempotency(
  input: IdempotencyInput,
  execute: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestHash = canonicalHash(input.body);
  const expiresAt = new Date(Date.now() + RETENTION_HOURS * 3600 * 1000);

  // Reserve the key. The unique constraint decides who wins a race.
  try {
    await prisma.idempotencyKey.create({
      data: {
        key: input.key,
        scope: input.scope,
        userId: input.userId,
        requestHash,
        status: 'IN_PROGRESS',
        lockedAt: new Date(),
        expiresAt,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const existing = await prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope: input.scope, key: input.key } },
    });

    if (!existing) throw error;

    if (existing.requestHash !== requestHash) {
      return NextResponse.json(
        {
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'This idempotency key was already used with a different request body.',
          },
        },
        { status: 409 },
      );
    }

    if (existing.status === 'COMPLETED' && existing.responseBody !== null) {
      return NextResponse.json(existing.responseBody, {
        status: existing.responseCode ?? 200,
        headers: { 'Idempotent-Replay': 'true' },
      });
    }

    // A concurrent request holds the key and has not finished.
    return NextResponse.json(
      {
        error: {
          code: 'IDEMPOTENCY_IN_PROGRESS',
          message: 'An identical request is already being processed. Retry shortly.',
        },
      },
      { status: 409, headers: { 'Retry-After': '2' } },
    );
  }

  try {
    const response = await execute();
    const cloned = response.clone();
    let payload: unknown = null;
    try {
      payload = await cloned.json();
    } catch {
      payload = null;
    }

    await prisma.idempotencyKey.update({
      where: { scope_key: { scope: input.scope, key: input.key } },
      data: {
        status: 'COMPLETED',
        responseCode: response.status,
        responseBody: payload as object,
        completedAt: new Date(),
      },
    });

    return response;
  } catch (error) {
    // Release the key so a legitimate retry can proceed. Leaving it reserved
    // would permanently block a customer whose first attempt hit a transient
    // failure.
    await prisma.idempotencyKey
      .delete({ where: { scope_key: { scope: input.scope, key: input.key } } })
      .catch(() => undefined);
    throw error;
  }
}

export async function pruneExpiredIdempotencyKeys(): Promise<number> {
  const result = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
