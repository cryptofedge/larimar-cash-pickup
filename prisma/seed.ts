/**
 * Database seed — DEMO DATA ONLY.
 *
 * Every institution and location below is FICTIONAL. No real bank, remittance
 * company, or payout network is named, implied, or represented as a partner,
 * because none is. Each institution carries `isDemo: true`, which drives the
 * mandatory "DEMO LOCATION — NOT A REAL PARTNER" banner everywhere a location
 * appears in the UI.
 *
 * Limits and pricing are engineering defaults, not legal thresholds or
 * commercial rates.
 */

// Run via `npm run db:seed`, which passes --env-file=.env. Node loads the file
// before any module here evaluates, which matters because src/server/env.ts
// validates its configuration at import time.
import { PrismaClient, type RoleName } from '@prisma/client';

import { hashPassword, encryptSecret } from '../src/server/auth/crypto';
import { generateTotpSecret } from '../src/server/auth/totp';
import { ROLE_PERMISSIONS, ROLES, type Permission } from '../src/server/auth/rbac';
import { CHART_OF_ACCOUNTS } from '../src/lib/domain/ledger';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPass123!';

const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  CUSTOMER: 'A traveler requesting Dominican pesos.',
  PICKUP_AGENT: 'Payout window staff. May verify and redeem codes at assigned locations only.',
  PICKUP_MANAGER: 'Supervises a payout location. Agent powers plus location administration.',
  COMPLIANCE_ANALYST: 'Places and releases holds, reviews KYC, resolves alerts. Cannot move money.',
  SUPPORT_AGENT: 'Reads transactions and answers tickets. Cannot approve payouts or change status.',
  FINANCE_ADMIN: 'Refunds, ledger, settlement, and pricing configuration. Cannot change roles.',
  SYSTEM_ADMIN: 'Platform configuration and user administration. Cannot clear compliance holds.',
};

const PERMISSION_DESCRIPTIONS: Partial<Record<Permission, string>> = {
  'transaction.create': 'Create a new cash pickup transaction',
  'pickup.redeem': 'Disburse cash against a verified pickup code',
  'compliance.hold.release': 'Release a transaction from compliance review',
  'refund.issue': 'Issue a refund against a captured payment',
  'admin.settings.manage': 'Change platform configuration',
};

async function seedRolesAndPermissions(): Promise<void> {
  const allPermissions = new Set<Permission>();
  for (const role of ROLES) {
    for (const permission of ROLE_PERMISSIONS[role]) allPermissions.add(permission);
  }

  for (const key of allPermissions) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: PERMISSION_DESCRIPTIONS[key] ?? key },
    });
  }

  for (const name of ROLES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { description: ROLE_DESCRIPTIONS[name] },
      create: { name, description: ROLE_DESCRIPTIONS[name] },
    });

    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...ROLE_PERMISSIONS[name]] } },
      select: { id: true },
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log(`  roles: ${ROLES.length}, permissions: ${allPermissions.size}`);
}

async function seedLedgerAccounts(): Promise<void> {
  for (const account of CHART_OF_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({
      where: { code: account.code },
      update: {},
      create: {
        code: account.code,
        name: account.name,
        type: account.type,
        currency: account.currency,
        normalBalance: account.normalBalance,
        isCustodial: account.isCustodial,
      },
    });
  }
  console.log(`  ledger accounts: ${CHART_OF_ACCOUNTS.length}`);
}

async function seedPricing(): Promise<void> {
  // Engineering defaults. NOT commercial pricing.
  await prisma.feeSchedule.upsert({
    where: { key_version: { key: 'do-standard', version: 1 } },
    update: { active: true },
    create: {
      key: 'do-standard',
      version: 1,
      countryCode: 'DO',
      platformFeeBps: 150, // 1.50%
      platformFeeMinMinor: 299n, // $2.99
      platformFeeMaxMinor: null,
      fxSpreadBps: 75, // 0.75%
      processingFeeBps: 290, // 2.90%
      processingFeeFixedMinor: 30n, // $0.30
      expeditedFeeMinor: 499n, // $4.99
      feeCurrency: 'USD',
      active: true,
    },
  });

  // Demo limits. These are ARBITRARY ENGINEERING DEFAULTS, not Dominican legal
  // thresholds. Real limits must be set by qualified counsel.
  await prisma.riskPolicy.upsert({
    where: { countryCode_version: { countryCode: 'DO', version: 1 } },
    update: { active: true },
    create: {
      countryCode: 'DO',
      version: 1,
      active: true,
      dailyLimitMinor: 100_000n, // $1,000.00
      monthlyLimitMinor: 500_000n, // $5,000.00
      perTransactionMinMinor: 1_000n, // $10.00
      perTransactionMaxMinor: 100_000n, // $1,000.00
      limitCurrency: 'USD',
      velocityWindowHours: 24,
      velocityMaxCount: 5,
      // Risk-based collection delay: low-risk customers collect immediately,
      // anything scoring MEDIUM or above waits 30 minutes. Demo values.
      collectionDelayMinutes: 30,
      collectionDelayRiskThreshold: 30,
      kycRequiredAboveMinor: 25_000n, // $250.00
      reviewScoreThreshold: 60,
      blockScoreThreshold: 85,
      highRiskCountries: ['KP', 'IR', 'SY', 'CU'],
    },
  });

  console.log('  fee schedule + risk policy: DO v1');
}

interface LocationSeed {
  code: string;
  branchName: string;
  addressLine1: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
  maxPayoutMinor: bigint;
  dailyCapacityMinor: bigint;
  riskTier: number;
  status?: 'ACTIVE' | 'TEMPORARILY_CLOSED';
}

interface InstitutionSeed {
  code: string;
  name: string;
  legalName: string;
  /// Commission per disbursement, basis points. Demo placeholder.
  commissionBps: number;
  locations: LocationSeed[];
}

const STANDARD_HOURS = [
  { day: 1, open: '08:30', close: '16:00' },
  { day: 2, open: '08:30', close: '16:00' },
  { day: 3, open: '08:30', close: '16:00' },
  { day: 4, open: '08:30', close: '16:00' },
  { day: 5, open: '08:30', close: '17:00' },
  { day: 6, open: '09:00', close: '13:00' },
  { day: 0, closed: true },
];

const RESORT_HOURS = [
  { day: 1, open: '08:00', close: '20:00' },
  { day: 2, open: '08:00', close: '20:00' },
  { day: 3, open: '08:00', close: '20:00' },
  { day: 4, open: '08:00', close: '20:00' },
  { day: 5, open: '08:00', close: '20:00' },
  { day: 6, open: '09:00', close: '18:00' },
  { day: 0, open: '10:00', close: '16:00' },
];

/**
 * Fictional institutions. The names are deliberately transparent placeholders —
 * "Ejemplo" (example), "Demostración" (demonstration), "Prueba" (test) — so no
 * reader could mistake one for a real Dominican financial institution.
 */
const INSTITUTIONS: InstitutionSeed[] = [
  {
    code: 'DEMO-BEN',
    name: 'Banco Ejemplo Nacional (DEMO)',
    legalName: 'Banco Ejemplo Nacional, S.A. — FICTIONAL ENTITY',
    commissionBps: 100,
    locations: [
      {
        code: 'BEN-SDQ-01',
        branchName: 'Sucursal Piantini',
        addressLine1: 'Av. Winston Churchill 1099',
        city: 'Santo Domingo',
        province: 'Distrito Nacional',
        latitude: 18.4726,
        longitude: -69.9401,
        maxPayoutMinor: 10_000_000n, // RD$100,000
        dailyCapacityMinor: 200_000_000n,
        riskTier: 0,
      },
      {
        code: 'BEN-SDQ-02',
        branchName: 'Sucursal Zona Colonial',
        addressLine1: 'Calle El Conde 253',
        city: 'Santo Domingo',
        province: 'Distrito Nacional',
        latitude: 18.4735,
        longitude: -69.8836,
        maxPayoutMinor: 5_000_000n,
        dailyCapacityMinor: 80_000_000n,
        riskTier: 1,
      },
      {
        code: 'BEN-STI-01',
        branchName: 'Sucursal Santiago Centro',
        addressLine1: 'Calle del Sol 62',
        city: 'Santiago de los Caballeros',
        province: 'Santiago',
        latitude: 19.4517,
        longitude: -70.697,
        maxPayoutMinor: 8_000_000n,
        dailyCapacityMinor: 120_000_000n,
        riskTier: 0,
      },
      {
        code: 'BEN-POP-01',
        branchName: 'Sucursal Puerto Plata',
        addressLine1: 'Calle Separación 18',
        city: 'Puerto Plata',
        province: 'Puerto Plata',
        latitude: 19.7934,
        longitude: -70.6884,
        maxPayoutMinor: 5_000_000n,
        dailyCapacityMinor: 60_000_000n,
        riskTier: 1,
      },
    ],
  },
  {
    code: 'DEMO-CCD',
    name: 'Casa de Cambio Demostración (DEMO)',
    legalName: 'Casa de Cambio Demostración, SRL — FICTIONAL ENTITY',
    commissionBps: 150,
    locations: [
      {
        code: 'CCD-PUJ-01',
        branchName: 'Punta Cana — Plaza Turística',
        addressLine1: 'Blvd. Turístico del Este, Km 4',
        city: 'Punta Cana',
        province: 'La Altagracia',
        latitude: 18.5601,
        longitude: -68.3725,
        maxPayoutMinor: 6_000_000n,
        dailyCapacityMinor: 100_000_000n,
        riskTier: 1,
      },
      {
        code: 'CCD-BAV-01',
        branchName: 'Bávaro — Av. Estados Unidos',
        addressLine1: 'Av. Estados Unidos 12, Bávaro',
        city: 'Bávaro',
        province: 'La Altagracia',
        latitude: 18.65,
        longitude: -68.4,
        maxPayoutMinor: 6_000_000n,
        dailyCapacityMinor: 90_000_000n,
        riskTier: 1,
      },
      {
        code: 'CCD-LRM-01',
        branchName: 'La Romana — Centro',
        addressLine1: 'Calle Duarte 45',
        city: 'La Romana',
        province: 'La Romana',
        latitude: 18.4273,
        longitude: -68.9728,
        maxPayoutMinor: 4_000_000n,
        dailyCapacityMinor: 50_000_000n,
        riskTier: 2,
      },
    ],
  },
  {
    code: 'DEMO-RPP',
    name: 'Red de Pagos Prueba (DEMO)',
    legalName: 'Red de Pagos Prueba, SRL — FICTIONAL ENTITY',
    commissionBps: 175,
    locations: [
      {
        code: 'RPP-SPM-01',
        branchName: 'San Pedro de Macorís — Malecón',
        addressLine1: 'Av. Independencia 7',
        city: 'San Pedro de Macorís',
        province: 'San Pedro de Macorís',
        latitude: 18.4539,
        longitude: -69.3086,
        maxPayoutMinor: 3_000_000n,
        dailyCapacityMinor: 40_000_000n,
        riskTier: 2,
      },
      {
        code: 'RPP-SDQ-01',
        branchName: 'Santo Domingo Este — Megacentro',
        addressLine1: 'Av. San Vicente de Paúl',
        city: 'Santo Domingo',
        province: 'Santo Domingo',
        latitude: 18.4896,
        longitude: -69.8574,
        maxPayoutMinor: 4_000_000n,
        dailyCapacityMinor: 55_000_000n,
        riskTier: 1,
      },
      {
        code: 'RPP-STI-02',
        branchName: 'Santiago — Los Jardines',
        addressLine1: 'Av. 27 de Febrero 210',
        city: 'Santiago de los Caballeros',
        province: 'Santiago',
        latitude: 19.4614,
        longitude: -70.6885,
        maxPayoutMinor: 3_000_000n,
        dailyCapacityMinor: 35_000_000n,
        riskTier: 1,
        status: 'TEMPORARILY_CLOSED',
      },
    ],
  },
];

async function seedPickupNetwork(): Promise<{ primaryLocationId: string; institutionId: string }> {
  let primaryLocationId = '';
  let institutionId = '';
  let locationCount = 0;

  for (const seed of INSTITUTIONS) {
    const institution = await prisma.pickupInstitution.upsert({
      where: { code: seed.code },
      update: { name: seed.name, legalName: seed.legalName, isDemo: true, commissionBps: seed.commissionBps },
      create: {
        code: seed.code,
        name: seed.name,
        legalName: seed.legalName,
        countryCode: 'DO',
        contactEmail: `operations@${seed.code.toLowerCase()}.demo.invalid`,
        // Commercial terms are placeholders. A real rate is negotiated per partner.
        commissionBps: seed.commissionBps,
        settlementCurrency: 'DOP',
        isDemo: true,
        active: true,
      },
    });

    if (seed.code === 'DEMO-CCD') institutionId = institution.id;

    for (const location of seed.locations) {
      const isResort = ['Punta Cana', 'Bávaro'].includes(location.city);
      const row = await prisma.pickupLocation.upsert({
        where: { code: location.code },
        update: { status: location.status ?? 'ACTIVE' },
        create: {
          institutionId: institution.id,
          code: location.code,
          branchName: location.branchName,
          addressLine1: location.addressLine1,
          city: location.city,
          province: location.province,
          countryCode: 'DO',
          latitude: location.latitude,
          longitude: location.longitude,
          openingHours: isResort ? RESORT_HOURS : STANDARD_HOURS,
          timezone: 'America/Santo_Domingo',
          pickupAvailable: true,
          supportedCurrencies: ['DOP'],
          maxPayoutMinor: location.maxPayoutMinor,
          dailyCapacityMinor: location.dailyCapacityMinor,
          status: location.status ?? 'ACTIVE',
          riskTier: location.riskTier,
          contactPhone: '+1 809 555 0100',
          notes: 'DEMO LOCATION — NOT A REAL PARTNER. Fictional branch for demonstration only.',
        },
      });

      if (location.code === 'CCD-PUJ-01') primaryLocationId = row.id;
      locationCount += 1;
    }
  }

  console.log(`  institutions: ${INSTITUTIONS.length}, locations: ${locationCount} (all DEMO)`);
  return { primaryLocationId, institutionId };
}

async function createUser(input: {
  email: string;
  roles: RoleName[];
  firstName: string;
  lastName: string;
  institutionId?: string;
  locationIds?: string[];
  withMfa?: boolean;
  locale?: 'EN' | 'ES';
}): Promise<string> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {},
    create: {
      email: input.email,
      emailVerifiedAt: new Date(),
      passwordHash,
      status: 'ACTIVE',
      locale: input.locale ?? 'EN',
      institutionId: input.institutionId ?? null,
      // Staff accounts carry a TOTP secret so the MFA path is exercisable.
      // In DEMO_MODE the login flow does not enforce the challenge; see README.
      mfaEnabled: input.withMfa ?? false,
      mfaSecretEnc: input.withMfa ? encryptSecret(generateTotpSecret()) : null,
      profile: {
        create: {
          firstName: input.firstName,
          lastName: input.lastName,
          residenceCountry: input.roles.includes('CUSTOMER') ? 'US' : 'DO',
        },
      },
    },
    select: { id: true },
  });

  const roles = await prisma.role.findMany({ where: { name: { in: input.roles } }, select: { id: true } });
  for (const role of roles) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  for (const locationId of input.locationIds ?? []) {
    await prisma.agentLocationAssignment.upsert({
      where: { userId_locationId: { userId: user.id, locationId } },
      update: { active: true },
      create: { userId: user.id, locationId, active: true },
    });
  }

  return user.id;
}

async function seedUsers(network: { primaryLocationId: string; institutionId: string }): Promise<void> {
  const ccdLocations = await prisma.pickupLocation.findMany({
    where: { institution: { code: 'DEMO-CCD' } },
    select: { id: true },
  });
  const allLocationIds = ccdLocations.map((l) => l.id);

  await createUser({ email: 'customer@example.com', roles: ['CUSTOMER'], firstName: 'John', lastName: 'Traveler' });
  await createUser({ email: 'customer2@example.com', roles: ['CUSTOMER'], firstName: 'Ana', lastName: 'Viajera', locale: 'ES' });

  await createUser({
    email: 'agent@example.com',
    roles: ['PICKUP_AGENT'],
    firstName: 'Ana',
    lastName: 'Reyes',
    institutionId: network.institutionId,
    locationIds: [network.primaryLocationId],
    withMfa: true,
    locale: 'ES',
  });

  await createUser({
    email: 'manager@example.com',
    roles: ['PICKUP_MANAGER'],
    firstName: 'Luis',
    lastName: 'Peña',
    institutionId: network.institutionId,
    locationIds: allLocationIds,
    withMfa: true,
    locale: 'ES',
  });

  await createUser({ email: 'compliance@example.com', roles: ['COMPLIANCE_ANALYST'], firstName: 'Marcos', lastName: 'Silva', withMfa: true });
  await createUser({ email: 'support@example.com', roles: ['SUPPORT_AGENT'], firstName: 'Sofia', lastName: 'Duarte', withMfa: true });
  await createUser({ email: 'finance@example.com', roles: ['FINANCE_ADMIN'], firstName: 'Elena', lastName: 'Cruz', withMfa: true });
  await createUser({ email: 'admin@example.com', roles: ['SYSTEM_ADMIN'], firstName: 'Root', lastName: 'Admin', withMfa: true });

  console.log('  demo users: 8');
}

async function seedSettings(): Promise<void> {
  const settings: { key: string; value: unknown; description: string; category: string }[] = [
    { key: 'platform.demoMode', value: true, description: 'Demo mode banner and mock providers', category: 'general' },
    { key: 'pickup.reminderDaysBeforeExpiry', value: 3, description: 'Send a pickup reminder this many days before expiry', category: 'notifications' },
    { key: 'compliance.autoReviewScore', value: 60, description: 'Risk score at or above which a transaction is held for review', category: 'compliance' },
    { key: 'support.email', value: 'support@larimar.demo.invalid', description: 'Displayed support address', category: 'support' },
  ];

  for (const setting of settings) {
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value as object },
      create: {
        key: setting.key,
        value: setting.value as object,
        description: setting.description,
        category: setting.category,
      },
    });
  }
  console.log(`  platform settings: ${settings.length}`);
}

async function main(): Promise<void> {
  console.log('Seeding Larimar demo data…\n');

  await seedRolesAndPermissions();
  await seedLedgerAccounts();
  await seedPricing();
  const network = await seedPickupNetwork();
  await seedUsers(network);
  await seedSettings();

  console.log('\nSeed complete.');
  console.log(`\nDemo credentials — password for every account: ${DEMO_PASSWORD}`);
  console.log('  customer@example.com    CUSTOMER');
  console.log('  agent@example.com       PICKUP_AGENT      (Punta Cana — Plaza Turística)');
  console.log('  manager@example.com     PICKUP_MANAGER');
  console.log('  compliance@example.com  COMPLIANCE_ANALYST');
  console.log('  support@example.com     SUPPORT_AGENT');
  console.log('  finance@example.com     FINANCE_ADMIN');
  console.log('  admin@example.com       SYSTEM_ADMIN');
  console.log('\nAll pickup locations are FICTIONAL. No real institution is a partner.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
