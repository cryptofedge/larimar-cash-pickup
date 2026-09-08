/**
 * Sessions.
 *
 * Opaque random tokens, stored hashed, delivered in an HttpOnly cookie. Not JWTs:
 * a cash platform needs instant, reliable, server-side revocation — when fraud is
 * suspected, "the token expires in 15 minutes" is not an acceptable answer.
 *
 * Two clocks run on every session. The absolute deadline caps total lifetime; the
 * idle deadline closes abandoned sessions on shared or hotel devices. Whichever
 * fires first ends the session.
 */

import { cookies } from 'next/headers';
import { prisma } from '../db';
import { env } from '../env';
import { generateToken, hashToken } from './crypto';
import {
  type Permission,
  type Role,
  hasPermission,
  isValidRole,
  permissionsForRoles,
  requiresMfa,
} from './rbac';

export interface Principal {
  readonly userId: string;
  readonly email: string;
  readonly sessionId: string;
  readonly roles: readonly Role[];
  readonly permissions: ReadonlySet<Permission>;
  readonly mfaSatisfied: boolean;
  readonly mfaRequired: boolean;
  readonly locale: 'EN' | 'ES';
  readonly institutionId: string | null;
  /** Locations a payout agent is authorised to act at. */
  readonly locationIds: readonly string[];
}

export interface SessionContext {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly deviceId?: string | null;
}

function absoluteExpiry(from: Date): Date {
  return new Date(from.getTime() + env.SESSION_ABSOLUTE_TTL_HOURS * 3600 * 1000);
}

function idleExpiry(from: Date): Date {
  return new Date(from.getTime() + env.SESSION_IDLE_TTL_MINUTES * 60 * 1000);
}

export async function createSession(
  userId: string,
  context: SessionContext & { mfaSatisfied?: boolean; previousId?: string },
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = generateToken(32);
  const now = new Date();

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      mfaSatisfied: context.mfaSatisfied ?? false,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      deviceId: context.deviceId ?? null,
      previousId: context.previousId ?? null,
      expiresAt: absoluteExpiry(now),
      idleExpiresAt: idleExpiry(now),
    },
  });

  return { token, sessionId: session.id, expiresAt: session.expiresAt };
}

/**
 * Resolve a token to a principal.
 *
 * Returns null for every failure mode — unknown, expired, idle-expired, revoked,
 * or belonging to a suspended user. The caller cannot distinguish them, and
 * should not be able to.
 */
export async function resolvePrincipal(token: string | undefined | null): Promise<Principal | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          roles: { include: { role: true } },
          agentLocations: { where: { active: true }, select: { locationId: true } },
        },
      },
    },
  });

  if (!session || session.revokedAt) return null;

  const now = new Date();
  if (now >= session.expiresAt || now >= session.idleExpiresAt) return null;
  if (session.user.deletedAt) return null;
  if (session.user.status !== 'ACTIVE') return null;

  // Sliding idle window. Written at most once a minute so a busy session does
  // not turn every request into a database write.
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now, idleExpiresAt: idleExpiry(now) },
    });
  }

  const roles = session.user.roles
    .map((r) => r.role.name as string)
    .filter(isValidRole);

  return {
    userId: session.user.id,
    email: session.user.email,
    sessionId: session.id,
    roles,
    permissions: permissionsForRoles(roles),
    mfaSatisfied: session.mfaSatisfied,
    mfaRequired: requiresMfa(roles),
    locale: session.user.locale,
    institutionId: session.user.institutionId,
    locationIds: session.user.agentLocations.map((a) => a.locationId),
  };
}

/**
 * Rotate on privilege change (MFA completion, role grant).
 *
 * A new token is issued and the old one revoked, so a token captured before the
 * privilege escalation cannot be replayed to reach the new privileges.
 */
export async function rotateSession(
  sessionId: string,
  changes: { mfaSatisfied?: boolean } = {},
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const existing = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!existing) throw new Error('Session not found');

  const next = await createSession(existing.userId, {
    ipAddress: existing.ipAddress,
    userAgent: existing.userAgent,
    deviceId: existing.deviceId,
    mfaSatisfied: changes.mfaSatisfied ?? existing.mfaSatisfied,
    previousId: existing.id,
  });

  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
  });

  return next;
}

export async function revokeSession(sessionId: string, reason = 'LOGOUT'): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Used on password change, suspected takeover, and administrative suspension. */
export async function revokeAllUserSessions(
  userId: string,
  reason = 'SECURITY',
  exceptSessionId?: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Cookie handling
// ---------------------------------------------------------------------------

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    // Lax rather than Strict: a traveler following an emailed receipt link should
    // still arrive logged in. State-changing routes are additionally protected by
    // origin checking, so Lax does not weaken CSRF defence here.
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(env.SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(env.SESSION_COOKIE_NAME)?.value;
}

/** The principal for the current request, or null. */
export async function getCurrentPrincipal(): Promise<Principal | null> {
  return resolvePrincipal(await readSessionToken());
}

/**
 * Fully authenticated: a valid session that has also satisfied MFA where the
 * principal's roles demand it. A staff member who has not completed the second
 * factor is treated as unauthenticated for every privileged surface.
 */
export function isFullyAuthenticated(principal: Principal): boolean {
  return !principal.mfaRequired || principal.mfaSatisfied;
}

export function principalCan(principal: Principal, permission: Permission): boolean {
  return isFullyAuthenticated(principal) && hasPermission(principal.roles, permission);
}
