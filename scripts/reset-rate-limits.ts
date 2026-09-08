/**
 * Clear rate-limit counters.
 *
 * Useful during local testing and demos, where every request shares one address
 * and the production-appropriate limits are quickly exhausted.
 *
 * NEVER run this against a live deployment: it removes an active abuse control.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const result = await prisma.rateLimitCounter.deleteMany({});
  console.log(`Cleared ${result.count} rate-limit counters.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
