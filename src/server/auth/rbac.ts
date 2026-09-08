/**
 * Role-based access control.
 *
 * Deny by default. A route declares the permission it needs; if the principal's
 * roles do not grant it, the request is refused before any handler logic runs.
 * The permission map is data so the whole access matrix can be asserted in a
 * single test rather than inferred from scattered `if` statements.
 *
 * Two separations of duty are deliberate and load-bearing:
 *   - A SUPPORT_AGENT can read everything about a transaction but cannot approve
 *     a payout or change its status. Support is the most socially-engineered
 *     role in any payments company.
 *   - A COMPLIANCE_ANALYST can hold and release funds but cannot issue refunds
 *     or move money, and FINANCE_ADMIN is the mirror image.
 */

export const ROLES = [
  'CUSTOMER',
  'PICKUP_AGENT',
  'PICKUP_MANAGER',
  'COMPLIANCE_ANALYST',
  'SUPPORT_AGENT',
  'FINANCE_ADMIN',
  'SYSTEM_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Customer-facing
  'transaction.create',
  'transaction.read.own',
  'transaction.cancel.own',
  'pickup.code.view.own',
  'profile.read.own',
  'profile.update.own',
  'kyc.submit.own',
  'support.ticket.create',

  // Payout window
  'pickup.verify',
  'pickup.redeem',
  'pickup.reject',
  'pickup.escalate',
  'pickup.location.read',
  'pickup.location.manage',
  'pickup.reverse',

  // Compliance
  'compliance.case.read',
  'compliance.case.assign',
  'compliance.hold.place',
  'compliance.hold.release',
  'compliance.kyc.review',
  'compliance.alert.resolve',

  // Support
  'support.ticket.read',
  'support.ticket.respond',
  'transaction.read.any',
  'customer.read.limited',

  // Finance
  'refund.issue',
  'ledger.read',
  'settlement.read',
  'pricing.read',
  'pricing.manage',
  'chargeback.manage',

  // Administration
  'admin.dashboard.read',
  'admin.user.read',
  'admin.user.manage',
  'admin.role.manage',
  'admin.settings.manage',
  'admin.audit.read',
  'admin.institution.manage',
  'risk.policy.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const CUSTOMER_PERMISSIONS: Permission[] = [
  'transaction.create',
  'transaction.read.own',
  'transaction.cancel.own',
  'pickup.code.view.own',
  'profile.read.own',
  'profile.update.own',
  'kyc.submit.own',
  'support.ticket.create',
];

const PICKUP_AGENT_PERMISSIONS: Permission[] = [
  'pickup.verify',
  'pickup.redeem',
  'pickup.reject',
  'pickup.escalate',
  'pickup.location.read',
];

const PICKUP_MANAGER_PERMISSIONS: Permission[] = [
  ...PICKUP_AGENT_PERMISSIONS,
  'pickup.location.manage',
  'pickup.reverse',
  'support.ticket.read',
];

const COMPLIANCE_PERMISSIONS: Permission[] = [
  'compliance.case.read',
  'compliance.case.assign',
  'compliance.hold.place',
  'compliance.hold.release',
  'compliance.kyc.review',
  'compliance.alert.resolve',
  'transaction.read.any',
  'customer.read.limited',
  'admin.dashboard.read',
  'admin.audit.read',
];

// Read-heavy and deliberately powerless over money or state.
const SUPPORT_PERMISSIONS: Permission[] = [
  'support.ticket.read',
  'support.ticket.respond',
  'transaction.read.any',
  'customer.read.limited',
  'pickup.location.read',
];

const FINANCE_PERMISSIONS: Permission[] = [
  'refund.issue',
  'ledger.read',
  'settlement.read',
  'pricing.read',
  'pricing.manage',
  'chargeback.manage',
  'transaction.read.any',
  'admin.dashboard.read',
  'admin.audit.read',
];

// Everything except the compliance decision seat — separation of duties means
// the person who configures the system does not also clear their own holds.
const SYSTEM_ADMIN_PERMISSIONS: Permission[] = PERMISSIONS.filter(
  (p) => p !== 'compliance.hold.release' && p !== 'compliance.kyc.review',
);

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  CUSTOMER: Object.freeze(CUSTOMER_PERMISSIONS),
  PICKUP_AGENT: Object.freeze(PICKUP_AGENT_PERMISSIONS),
  PICKUP_MANAGER: Object.freeze(PICKUP_MANAGER_PERMISSIONS),
  COMPLIANCE_ANALYST: Object.freeze(COMPLIANCE_PERMISSIONS),
  SUPPORT_AGENT: Object.freeze(SUPPORT_PERMISSIONS),
  FINANCE_ADMIN: Object.freeze(FINANCE_PERMISSIONS),
  SYSTEM_ADMIN: Object.freeze(SYSTEM_ADMIN_PERMISSIONS),
});

/** Roles that may reach any staff surface. Used to keep customers out wholesale. */
export const STAFF_ROLES: readonly Role[] = Object.freeze([
  'PICKUP_AGENT',
  'PICKUP_MANAGER',
  'COMPLIANCE_ANALYST',
  'SUPPORT_AGENT',
  'FINANCE_ADMIN',
  'SYSTEM_ADMIN',
]);

/** Staff roles must present a second factor. Non-negotiable. */
export const MFA_REQUIRED_ROLES: readonly Role[] = STAFF_ROLES;

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      set.add(permission);
    }
  }
  return set;
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => (ROLE_PERMISSIONS[role] ?? []).includes(permission));
}

export function hasAnyPermission(roles: readonly Role[], permissions: readonly Permission[]): boolean {
  return permissions.some((p) => hasPermission(roles, p));
}

export function isStaff(roles: readonly Role[]): boolean {
  return roles.some((role) => STAFF_ROLES.includes(role));
}

export function requiresMfa(roles: readonly Role[]): boolean {
  return roles.some((role) => MFA_REQUIRED_ROLES.includes(role));
}

export function isValidRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Location scoping for payout staff.
 *
 * An agent authorised at Bávaro must not be able to redeem a code routed to
 * Santiago. This is checked in addition to the permission, never instead of it.
 */
export function canActAtLocation(
  roles: readonly Role[],
  assignedLocationIds: readonly string[],
  targetLocationId: string,
): boolean {
  if (hasPermission(roles, 'admin.institution.manage')) return true;
  return assignedLocationIds.includes(targetLocationId);
}
