/**
 * Shared fixtures for integration tests.
 *
 * Each test creates its own isolated user so tests can run in any order without
 * interfering with each other's limits, velocity counters, or risk history.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db';
import { hashPassword } from '@/server/auth/crypto';
import type { RoleName } from '@prisma/client';

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createTestUser(
  roles: RoleName[] = ['CUSTOMER'],
  options: { verifiedKyc?: boolean; institutionCode?: string; locationCodes?: string[] } = {},
): Promise<TestUser> {
  const email = `test-${randomUUID().slice(0, 12)}@example.test`;
  const password = 'IntegrationTest123!';

  const institution = options.institutionCode
    ? await prisma.pickupInstitution.findUnique({
        where: { code: options.institutionCode },
        select: { id: true },
      })
    : null;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      institutionId: institution?.id ?? null,
      profile: { create: { firstName: 'Test', lastName: 'User', residenceCountry: 'US' } },
    },
    select: { id: true },
  });

  const roleRows = await prisma.role.findMany({ where: { name: { in: roles } }, select: { id: true } });
  await prisma.userRole.createMany({
    data: roleRows.map((role) => ({ userId: user.id, roleId: role.id })),
  });

  if (options.verifiedKyc) {
    await prisma.identityVerification.create({
      data: {
        userId: user.id,
        provider: 'mock',
        providerRef: `test_${randomUUID().slice(0, 8)}`,
        status: 'APPROVED',
        level: 'BASIC',
        documentType: 'PASSPORT',
        documentLast4: '4567',
        documentCountry: 'US',
        sanctionsChecked: true,
        decidedAt: new Date(),
      },
    });
  }

  for (const code of options.locationCodes ?? []) {
    const location = await prisma.pickupLocation.findUnique({
      where: { code },
      select: { id: true },
    });
    if (location) {
      await prisma.agentLocationAssignment.create({
        data: { userId: user.id, locationId: location.id, active: true },
      });
    }
  }

  return { id: user.id, email, password };
}

export async function getLocationId(code = 'CCD-PUJ-01'): Promise<string> {
  const location = await prisma.pickupLocation.findUniqueOrThrow({
    where: { code },
    select: { id: true },
  });
  return location.id;
}

export async function getInstitutionId(code = 'DEMO-CCD'): Promise<string> {
  const institution = await prisma.pickupInstitution.findUniqueOrThrow({
    where: { code },
    select: { id: true },
  });
  return institution.id;
}

/**
 * Remove everything a test user created, so repeat runs stay clean.
 *
 * Pickup events must go FIRST and explicitly. Both `PickupEvent.transaction` and
 * `PickupEvent.agent` are `onDelete: SetNull`, so deleting the transaction or the
 * user leaves the event behind with a null reference. Orphaned payout events
 * accumulate across runs and silently pollute later settlement periods — which is
 * exactly how the settlement suite started failing only when run alongside the
 * others.
 */
export async function cleanupUser(userId: string): Promise<void> {
  const transactions = await prisma.transaction.findMany({
    where: { userId },
    select: { id: true },
  });
  const transactionIds = transactions.map((t) => t.id);

  await prisma.pickupEvent.deleteMany({ where: { agentId: userId } });
  if (transactionIds.length > 0) {
    await prisma.pickupEvent.deleteMany({ where: { transactionId: { in: transactionIds } } });
    await prisma.settlementLine.deleteMany({ where: { transactionId: { in: transactionIds } } });
  }

  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.identityVerification.deleteMany({ where: { userId } });
  await prisma.agentLocationAssignment.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.device.deleteMany({ where: { userId } });
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { actorId: userId } });
  await prisma.userRole.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}
