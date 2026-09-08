import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { env } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness.
 *
 * Reports database reachability and demo mode, and deliberately nothing else —
 * no version numbers, dependency lists, or configuration. A health endpoint is
 * an unauthenticated surface and a common source of reconnaissance.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      demoMode: env.DEMO_MODE,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503 });
  }
}
