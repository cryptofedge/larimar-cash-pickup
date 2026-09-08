/**
 * Integration test setup.
 *
 * These tests run against a REAL PostgreSQL, because the properties they prove —
 * serialisable isolation, unique constraints, concurrent redemption producing
 * exactly one payout — cannot be demonstrated against a mock.
 *
 * The database is torn down and reseeded per file rather than per test: seeding
 * roles, permissions, and the pickup network is expensive, and each test creates
 * its own users and transactions so they do not collide.
 */

import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Integration tests need a real database:\n' +
        '  npm run db:up && npm run db:migrate && npm run db:seed',
    );
  }

  // Fail fast with a useful message rather than a connection error inside a test.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    throw new Error(
      'Cannot reach the database. Start it with:  npm run db:up\n' +
        `DATABASE_URL=${process.env.DATABASE_URL}`,
    );
  }

  const roleCount = await prisma.role.count();
  if (roleCount === 0) {
    throw new Error('Database is not seeded. Run:  npm run db:seed');
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});
