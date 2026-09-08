/**
 * Validated environment configuration.
 *
 * Parsed once, at import, through Zod. A missing or malformed secret fails the
 * process immediately rather than surfacing as a confusing runtime error three
 * layers deep during a payment.
 *
 * The DEMO_MODE interlock at the bottom is the important part: it is structurally
 * impossible to run this build with DEMO_MODE=false while any provider is still a
 * mock. That interlock is what stops a demo binary from ever being mistaken for a
 * production one.
 */

import { z } from 'zod';

const base64Secret = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters`)
    .refine((v) => !v.startsWith('replace-me'), `${name} still holds its placeholder value`);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_NAME: z.string().default('Larimar'),
  DEMO_MODE: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),

  /**
   * Insecure demo shortcuts, each behind its own flag.
   *
   * Previously these piggybacked on DEMO_MODE, which meant disabling either one
   * required abandoning demo mode entirely — so in practice neither ever got
   * disabled. Separate flags make each a single, named, greppable decision, and
   * `demoShortcutWarnings()` prints exactly which are live at startup.
   */
  DEMO_ALLOW_MFA_BYPASS: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  DEMO_LOG_RESET_TOKENS: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  SESSION_SECRET: base64Secret('SESSION_SECRET'),
  ENCRYPTION_KEY: base64Secret('ENCRYPTION_KEY'),
  PICKUP_CODE_PEPPER: base64Secret('PICKUP_CODE_PEPPER'),

  SESSION_ABSOLUTE_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_IDLE_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_COOKIE_NAME: z.string().default('larimar_session'),

  PAYMENT_PROVIDER: z.string().default('mock'),
  EXCHANGE_RATE_PROVIDER: z.string().default('mock'),
  KYC_PROVIDER: z.string().default('mock'),
  SANCTIONS_PROVIDER: z.string().default('mock'),
  NOTIFICATION_TRANSPORT: z.string().default('mock'),

  PAYMENT_WEBHOOK_SECRET: base64Secret('PAYMENT_WEBHOOK_SECRET'),
  KYC_WEBHOOK_SECRET: base64Secret('KYC_WEBHOOK_SECRET'),
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),

  PARTNER_API_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  PARTNER_SIGNATURE_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),

  RATE_LIMIT_LOGIN_PER_15MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_REGISTER_PER_HOUR: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_QUOTE_PER_MIN: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_PICKUP_VERIFY_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_DEFAULT_PER_MIN: z.coerce.number().int().positive().default(120),

  DEFAULT_COUNTRY: z.string().length(2).default('DO'),
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  RATE_DRIFT_TOLERANCE_BPS: z.coerce.number().int().nonnegative().default(50),
  PICKUP_CODE_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PICKUP_CODE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  DEMO_PASSWORD: z.string().default('DemoPass123!'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Copy .env.example to .env and fill in every secret. ' +
        'Generate secrets with: openssl rand -base64 32',
    );
  }

  const env = parsed.data;

  // The interlock. Mock providers simulate money; they must never be reachable
  // from a build that claims not to be a demo.
  if (!env.DEMO_MODE) {
    const mocked = (
      [
        ['PAYMENT_PROVIDER', env.PAYMENT_PROVIDER],
        ['EXCHANGE_RATE_PROVIDER', env.EXCHANGE_RATE_PROVIDER],
        ['KYC_PROVIDER', env.KYC_PROVIDER],
        ['SANCTIONS_PROVIDER', env.SANCTIONS_PROVIDER],
      ] as const
    ).filter(([, value]) => value === 'mock');

    if (mocked.length > 0) {
      throw new Error(
        'DEMO_MODE is false but these providers are still mocks: ' +
          mocked.map(([name]) => name).join(', ') +
          '.\nA non-demo build must not simulate money movement. ' +
          'See docs/LEGAL_AND_COMPLIANCE.md before disabling demo mode.',
      );
    }
  }

  // The encryption key must decode to exactly 32 bytes for AES-256-GCM.
  const keyBytes = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (keyBytes.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM; got ${keyBytes.length}. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }

  return env;
}

export const env: Env = loadEnv();

export const isDemoMode = (): boolean => env.DEMO_MODE;
export const isProduction = (): boolean => env.NODE_ENV === 'production';

/**
 * Insecure shortcuts currently active. Empty means none.
 *
 * Returned as data rather than logged directly so the health endpoint, the admin
 * console, and startup can all surface the same list. An insecure default that
 * nobody can see is the one that ships.
 */
export function demoShortcutWarnings(): string[] {
  const active: string[] = [];

  if (env.DEMO_MODE) {
    active.push('DEMO_MODE: mock providers are installed; no real money moves.');
  }
  if (env.DEMO_ALLOW_MFA_BYPASS) {
    active.push(
      'DEMO_ALLOW_MFA_BYPASS: staff accounts sign in WITHOUT a second factor. Never enable in production.',
    );
  }
  if (env.DEMO_LOG_RESET_TOKENS) {
    active.push(
      'DEMO_LOG_RESET_TOKENS: password reset tokens are printed to the console. Never enable in production.',
    );
  }

  return active;
}

// Print the active shortcuts once, at import, so they cannot go unnoticed. In
// production with everything disabled this prints nothing at all.
{
  const warnings = demoShortcutWarnings();
  if (warnings.length > 0 && process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.warn(
      ['', '  ⚠  INSECURE DEMO SHORTCUTS ACTIVE', ...warnings.map((w) => `     - ${w}`), ''].join(
        '\n',
      ),
    );
  }
}
