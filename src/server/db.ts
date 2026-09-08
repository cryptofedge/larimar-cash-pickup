/**
 * Prisma client singleton.
 *
 * Next.js dev mode re-evaluates modules on every hot reload; without the global
 * cache each reload opens a fresh connection pool until PostgreSQL refuses new
 * connections.
 */

import { PrismaClient } from '@prisma/client';
import { env } from './env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** The transaction client type, for services that must run inside an existing tx. */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Run work at SERIALIZABLE isolation.
 *
 * Used for anything where a concurrent duplicate would be a financial loss:
 * pickup-code redemption, payment capture, ledger posting. Postgres will abort
 * one of two conflicting serialisable transactions, which is exactly the
 * behaviour we want — the database, not application logic, is the arbiter.
 */
export async function withSerializableTransaction<T>(
  fn: (tx: PrismaTransactionClient) => Promise<T>,
  options: { timeoutMs?: number; maxWaitMs?: number } = {},
): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: 'Serializable',
    timeout: options.timeoutMs ?? 15_000,
    maxWait: options.maxWaitMs ?? 5_000,
  });
}

/** Postgres serialisation failure — the caller may safely retry. */
export function isSerializationFailure(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === 'P2034' || code === '40001';
}

/** Prisma unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}
