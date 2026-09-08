/**
 * Clear settlement batches and orphaned pickup events left by earlier test runs.
 *
 * Pickup events survive transaction deletion (onDelete: SetNull), so runs from
 * before the cleanup fix in tests/integration/helpers.ts left orphans behind.
 * Those orphans pollute settlement periods and make the suite fail only when
 * files run together.
 *
 * Development and test databases only.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const lines = await prisma.settlementLine.deleteMany({});
  const batches = await prisma.settlementBatch.deleteMany({});
  const orphans = await prisma.pickupEvent.deleteMany({ where: { transactionId: null } });
  console.log(
    `Purged ${lines.count} settlement lines, ${batches.count} batches, ${orphans.count} orphaned pickup events.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
