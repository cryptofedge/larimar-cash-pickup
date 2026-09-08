/**
 * Authentication service.
 *
 * Two properties matter most here and shape everything else:
 *
 *  1. **No user enumeration.** Registration with an existing address, login with
 *     an unknown address, and password reset for an unknown address all behave
 *     exactly like the success case from the client's perspective. An attacker
 *     cannot use these endpoints to build a list of customers.
 *
 *  2. **Constant work.** The login path verifies a password hash even when no
 *     user exists, so response time does not reveal whether an account is real.
 */

import { prisma } from '../db';
import { env } from '../env';
import { DomainError } from '@/lib/domain/errors';
import type { Locale } from '@/i18n/config';
import {
  decryptSecret,
  generateToken,
  hashPassword,
  hashToken,
  needsRehash,
  verifyPassword,
} from '../auth/crypto';
import { verifyTotp } from '../auth/totp';
import { createSession, revokeAllUserSessions, revokeSession } from '../auth/session';
import { requiresMfa, isValidRole, type Role } from '../auth/rbac';
import { writeAudit, writeAuditFailure } from './audit';
import { enqueueNotification } from './notification';

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

/**
 * A real scrypt hash of a random string, computed once at startup and verified
 * against when no user exists. Without it, a missing account returns in
 * microseconds while a real one takes ~100ms — a trivially observable oracle.
 */
let decoyHash: string | null = null;
async function getDecoyHash(): Promise<string> {
  decoyHash ??= await hashPassword(generateToken(24));
  return decoyHash;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly locale?: Locale;
  readonly deviceFingerprint?: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface AuthResult {
  readonly token: string;
  readonly expiresAt: Date;
  readonly userId: string;
  readonly roles: readonly Role[];
  readonly mfaRequired: boolean;
}

export async function register(input: RegisterInput): Promise<AuthResult | null> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  // Do the same work either way, then return null. The route responds
  // identically for both branches, so registration cannot enumerate accounts.
  const passwordHash = await hashPassword(input.password);
  if (existing) {
    await writeAuditFailure({
      actorType: 'anonymous',
      action: 'auth.register.duplicate',
      resourceType: 'user',
      reason: 'Email already registered',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return null;
  }

  const customerRole = await prisma.role.findUnique({
    where: { name: 'CUSTOMER' },
    select: { id: true },
  });
  if (!customerRole) {
    throw new DomainError('CONFIGURATION_ERROR', 'CUSTOMER role is missing. Run the seed.');
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        status: 'ACTIVE',
        locale: input.locale === 'es' ? 'ES' : 'EN',
        // In DEMO_MODE the address is treated as verified so the flow is
        // walkable end to end. Production must require a real click-through.
        emailVerifiedAt: env.DEMO_MODE ? new Date() : null,
        profile: { create: { firstName: input.firstName, lastName: input.lastName } },
        roles: { create: { roleId: customerRole.id } },
      },
      select: { id: true, email: true, locale: true },
    });

    if (input.deviceFingerprint) {
      await tx.device.create({
        data: {
          userId: created.id,
          fingerprint: input.deviceFingerprint,
          firstSeenIp: input.ipAddress ?? null,
          lastSeenIp: input.ipAddress ?? null,
        },
      });
    }

    await enqueueNotification(
      {
        userId: created.id,
        channel: 'EMAIL',
        event: 'account.created',
        recipient: created.email,
        locale: created.locale === 'ES' ? 'es' : 'en',
      },
      tx,
    );

    await writeAudit(
      {
        actorId: created.id,
        actorType: 'customer',
        action: 'auth.register',
        resourceType: 'user',
        resourceId: created.id,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      tx,
    );

    return created;
  });

  const device = input.deviceFingerprint
    ? await prisma.device.findUnique({
        where: { userId_fingerprint: { userId: user.id, fingerprint: input.deviceFingerprint } },
        select: { id: true },
      })
    : null;

  const session = await createSession(user.id, {
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    deviceId: device?.id ?? null,
    mfaSatisfied: true, // A new customer has no second factor enrolled yet.
  });

  return {
    token: session.token,
    expiresAt: session.expiresAt,
    userId: user.id,
    roles: ['CUSTOMER'],
    mfaRequired: false,
  };
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly totpCode?: string;
  readonly deviceFingerprint?: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export type LoginResult =
  | { readonly ok: true; readonly auth: AuthResult }
  | { readonly ok: false; readonly code: 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED' | 'MFA_REQUIRED' | 'MFA_INVALID' };

export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { roles: { include: { role: true } } },
  });

  if (!user || user.deletedAt) {
    // Constant work, so timing does not distinguish this branch.
    await verifyPassword(input.password, await getDecoyHash());
    await writeAuditFailure({
      actorType: 'anonymous',
      action: 'auth.login',
      resourceType: 'user',
      reason: 'No such account',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, code: 'ACCOUNT_LOCKED' };
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);

  if (!passwordValid) {
    const failures = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failures,
        lockedUntil:
          failures >= MAX_FAILED_LOGINS
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : null,
      },
    });

    await writeAuditFailure({
      actorId: user.id,
      actorType: 'customer',
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      reason: 'Incorrect password',
      metadata: { failedAttempts: failures },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    if (failures >= MAX_FAILED_LOGINS) {
      await enqueueNotification(
        {
          userId: user.id,
          channel: 'EMAIL',
          event: 'security.suspiciousActivity',
          recipient: user.email,
          locale: user.locale === 'ES' ? 'es' : 'en',
        },
        prisma,
      );
      return { ok: false, code: 'ACCOUNT_LOCKED' };
    }

    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }

  if (user.status !== 'ACTIVE') {
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }

  const roles = user.roles.map((r) => r.role.name as string).filter(isValidRole);
  const mfaNeeded = requiresMfa(roles) || user.mfaEnabled;

  let mfaSatisfied = !mfaNeeded;

  if (mfaNeeded) {
    if (!input.totpCode) {
      // In DEMO_MODE staff accounts are usable without an authenticator app, so
      // the whole platform is walkable from a fresh clone. Production must not
      // take this branch — see README "Known limitations".
      if (env.DEMO_MODE) {
        mfaSatisfied = true;
      } else {
        return { ok: false, code: 'MFA_REQUIRED' };
      }
    } else if (user.mfaSecretEnc) {
      mfaSatisfied = verifyTotp(decryptSecret(user.mfaSecretEnc), input.totpCode);
      if (!mfaSatisfied) {
        await writeAuditFailure({
          actorId: user.id,
          actorType: 'customer',
          action: 'auth.mfa',
          resourceType: 'user',
          resourceId: user.id,
          reason: 'Invalid TOTP code',
          ipAddress: input.ipAddress,
        });
        return { ok: false, code: 'MFA_INVALID' };
      }
    } else if (env.DEMO_MODE) {
      mfaSatisfied = true;
    } else {
      return { ok: false, code: 'MFA_REQUIRED' };
    }
  }

  // Transparently upgrade a hash computed under weaker parameters.
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.password) },
    });
  }

  let deviceId: string | null = null;
  if (input.deviceFingerprint) {
    const device = await prisma.device.upsert({
      where: { userId_fingerprint: { userId: user.id, fingerprint: input.deviceFingerprint } },
      update: { lastSeenAt: new Date(), lastSeenIp: input.ipAddress ?? null },
      create: {
        userId: user.id,
        fingerprint: input.deviceFingerprint,
        firstSeenIp: input.ipAddress ?? null,
        lastSeenIp: input.ipAddress ?? null,
      },
      select: { id: true, blocked: true },
    });
    if (device.blocked) {
      return { ok: false, code: 'INVALID_CREDENTIALS' };
    }
    deviceId = device.id;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: input.ipAddress ?? null,
    },
  });

  const session = await createSession(user.id, {
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    deviceId,
    mfaSatisfied,
  });

  await writeAudit({
    actorId: user.id,
    actorType: 'customer',
    actorRoles: roles,
    action: 'auth.login',
    resourceType: 'user',
    resourceId: user.id,
    metadata: { mfaSatisfied },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    ok: true,
    auth: {
      token: session.token,
      expiresAt: session.expiresAt,
      userId: user.id,
      roles,
      mfaRequired: mfaNeeded,
    },
  };
}

export async function logout(sessionId: string, userId: string, ipAddress?: string | null): Promise<void> {
  await revokeSession(sessionId, 'LOGOUT');
  await writeAudit({
    actorId: userId,
    actorType: 'customer',
    action: 'auth.logout',
    resourceType: 'session',
    resourceId: sessionId,
    ipAddress,
  });
}

/**
 * Begin a password reset.
 *
 * Always resolves the same way. The caller responds "if that address is
 * registered, a link is on its way" regardless, so this endpoint reveals nothing.
 */
export async function requestPasswordReset(input: {
  email: string;
  ipAddress?: string | null;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, locale: true, deletedAt: true },
  });

  if (!user || user.deletedAt) return;

  const token = generateToken(32);

  await prisma.$transaction(async (tx) => {
    // One live reset at a time.
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 3600 * 1000),
        requestIp: input.ipAddress ?? null,
      },
    });

    await enqueueNotification(
      {
        userId: user.id,
        channel: 'EMAIL',
        event: 'account.passwordReset',
        recipient: user.email,
        locale: user.locale === 'ES' ? 'es' : 'en',
      },
      tx,
    );

    await writeAudit(
      {
        actorId: user.id,
        actorType: 'customer',
        action: 'auth.passwordReset.request',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: input.ipAddress,
      },
      tx,
    );
  });

  // In DEMO_MODE the token is logged so the flow is walkable without a mail
  // server. This line must never exist in a production build.
  if (env.DEMO_MODE) {
    console.log(`[demo] password reset token for ${user.email}: ${token}`);
  }
}

export async function completePasswordReset(input: {
  token: string;
  password: string;
  ipAddress?: string | null;
}): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new DomainError('VALIDATION_ERROR', 'That reset link is invalid or has expired.');
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, passwordUpdatedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });

    await writeAudit(
      {
        actorId: record.userId,
        actorType: 'customer',
        action: 'auth.passwordReset.complete',
        resourceType: 'user',
        resourceId: record.userId,
        ipAddress: input.ipAddress,
      },
      tx,
    );
  });

  // Every existing session dies. If the reset was an attacker recovering an
  // account, this evicts them; if it was the owner, re-authenticating is cheap.
  await revokeAllUserSessions(record.userId, 'PASSWORD_CHANGED');
}

export async function getCurrentUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      status: true,
      locale: true,
      mfaEnabled: true,
      emailVerifiedAt: true,
      createdAt: true,
      lastLoginAt: true,
      profile: {
        select: {
          firstName: true,
          lastName: true,
          phoneE164: true,
          residenceCountry: true,
          city: true,
        },
      },
      roles: { select: { role: { select: { name: true } } } },
      identityVerifications: {
        where: { status: 'APPROVED' },
        select: { level: true, decidedAt: true },
        take: 1,
      },
    },
  });
}
