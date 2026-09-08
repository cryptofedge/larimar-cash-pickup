# Larimar — Deployment

> **Nothing in this document authorises processing real money.** It describes how
> to run the software. Whether you may lawfully operate it is a separate question
> answered in [`LEGAL_AND_COMPLIANCE.md`](./LEGAL_AND_COMPLIANCE.md).

---

## Local development

**Requirements:** Node 20+, Docker, npm.

```bash
npm install
cp .env.example .env
```

Generate real secrets — the application **refuses to boot** with the placeholder
values:

```bash
node -e "const f=require('fs'),c=require('crypto');let t=f.readFileSync('.env','utf8');t=t.replace(/replace-me-with-openssl-rand-base64-32/g,()=>c.randomBytes(32).toString('base64'));f.writeFileSync('.env',t);console.log('secrets generated')"
```

Or individually: `openssl rand -base64 32`.

```bash
npm run db:up        # PostgreSQL 16 on host port 5433
npm run db:migrate
npm run db:seed
npm run dev
```

Port **5433**, not 5432, so it does not collide with a local PostgreSQL install.
On Windows, note that some ports are reserved by Hyper-V — check with
`netsh interface ipv4 show excludedportrange protocol=tcp` if a bind fails.

### Verify the installation

```bash
npm run demo         # full lifecycle against the real database, ~20 assertions
npm test             # 281 unit tests, no infrastructure
npm run test:all     # + 61 integration tests (needs the database)
npm run test:e2e     # 28 Playwright tests (builds and serves the app)
npm run typecheck && npm run lint
```

---

## Docker

```bash
docker compose up -d db
docker compose --profile full up --build
```

The image is multi-stage: dependencies, build, then a runtime carrying no build
toolchain, running as a non-root user (uid 1001).

Build-time environment variables are **placeholders**. Real secrets are injected
at runtime and never baked into a layer — a secret in an image layer is a secret
in every registry that image reaches.

---

## Deploying to a free host (Vercel + Neon)

The cheapest combination that actually runs this app is **Vercel Hobby** for the
application and **Neon** for PostgreSQL. Both have real free tiers that do not
expire and do not ask for a card. Most of the obvious alternatives no longer
qualify: Railway ended its free tier, Fly.io removed its free allowances, and
Render's free Postgres is time-limited. Free tiers change — check before relying
on any of this.

Two properties of this codebase make serverless hosting safe:

- **Rate limiting and idempotency are database-backed**, not in-memory. On a
  platform that runs many short-lived instances, an in-memory limiter silently
  degrades to no limiter at all. Here the counters are shared.
- **Middleware avoids Node built-ins.** The CSP nonce uses `btoa`, not `Buffer`,
  because middleware runs on the Edge Runtime in production. A throw there takes
  down every route on the site rather than one.

Vercel Hobby is licensed for non-commercial use. A demonstration qualifies; a
real service does not, which is academic here for the reasons in
[`LEGAL_AND_COMPLIANCE.md`](./LEGAL_AND_COMPLIANCE.md).

### 1. Create the database

Sign in at [neon.tech](https://neon.tech), create a project, and copy **both**
connection strings from the dashboard:

| String | Contains | Used by |
| --- | --- | --- |
| Pooled | `-pooler` in the host | The app at runtime, on Vercel |
| Direct | no `-pooler` | Migrations and seeding, from your machine |

Pooled connections route through PgBouncer, which does not support the session
state that DDL needs. Running migrations through the pooled string fails in ways
that read as unrelated errors, so use the direct string for those.

### 2. Migrate and seed, from your machine

```bash
DATABASE_URL="<direct connection string>" npx prisma migrate deploy
DATABASE_URL="<direct connection string>" npx prisma db seed
```

The seed writes three fictional institutions, ten demo locations, and eight demo
users. Skip it and the app runs but every location list is empty.

### 3. Deploy the app

Import the repository at [vercel.com/new](https://vercel.com/new). The framework
is detected automatically; `prisma generate` already runs as part of `build`, so
no build-command override is needed.

Set these environment variables in the Vercel project before the first deploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the **pooled** Neon string |
| `APP_URL` | your deployment URL, e.g. `https://larimar.vercel.app` |
| `NODE_ENV` | `production` |
| `DEMO_MODE` | `true` |
| `SESSION_SECRET` | generate — see below |
| `ENCRYPTION_KEY` | generate — must decode to exactly 32 bytes |
| `PICKUP_CODE_PEPPER` | generate |
| `PAYMENT_WEBHOOK_SECRET` | generate |
| `KYC_WEBHOOK_SECRET` | generate |

Generate all five:

```bash
node -e "['SESSION_SECRET','ENCRYPTION_KEY','PICKUP_CODE_PEPPER','PAYMENT_WEBHOOK_SECRET','KYC_WEBHOOK_SECRET'].forEach(k=>console.log(k+'='+require('node:crypto').randomBytes(32).toString('base64')))"
```

`APP_URL` must match the deployed origin exactly. It is what the same-origin
check on state-changing routes compares against, so a mismatch rejects every POST
with a confusing 403.

### 4. Verify

```bash
curl -s https://<your-domain>/api/health
curl -sI https://<your-domain>/ | grep -i content-security-policy
```

The health endpoint confirms the database is reachable. The CSP header confirms
middleware is executing — if it is missing, the Edge Runtime threw, and every
page will be blank despite a green build.

### Keep in mind

- **`DEMO_MODE` must stay `true`.** Setting it to `false` while the mock payment,
  KYC, and sanctions providers are configured makes the app refuse to boot, by
  design. That interlock exists so a demo cannot be promoted to something that
  looks real by flipping one variable.
- **Rotating `PICKUP_CODE_PEPPER` invalidates every outstanding pickup code**,
  because codes are stored as single-pepper hashes. Set it once before going
  live and leave it alone.
- **Neon suspends an idle free database.** The first request after a pause takes
  a few seconds while it resumes; it is not a bug.

## Configuration

Every variable is validated by Zod at import in `src/server/env.ts`. A missing or
malformed value fails the process at startup rather than surfacing three layers
deep during a payment.

### Required

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | ≥ 32 chars |
| `ENCRYPTION_KEY` | **Must decode to exactly 32 bytes** (AES-256-GCM) |
| `PICKUP_CODE_PEPPER` | ≥ 32 chars. **Rotating this invalidates every outstanding pickup code.** |
| `PAYMENT_WEBHOOK_SECRET` | |
| `KYC_WEBHOOK_SECRET` | |
| `APP_URL` | Used for the origin check; must match the public URL exactly |

### The DEMO_MODE interlock

```
DEMO_MODE=true   → mock providers, seeded demo accounts, staff MFA bypassed
DEMO_MODE=false  → the process REFUSES TO START if any provider is still "mock"
```

This is deliberate and structural: it is impossible to run a build that claims
not to be a demo while simulating money movement. The check is in
`src/server/env.ts` and is not overridable by configuration.

### Tunable

`SESSION_ABSOLUTE_TTL_HOURS` (12) · `SESSION_IDLE_TTL_MINUTES` (30) ·
`QUOTE_TTL_SECONDS` (900) · `RATE_DRIFT_TOLERANCE_BPS` (50) ·
`PICKUP_CODE_TTL_DAYS` (30) · `PICKUP_CODE_MAX_ATTEMPTS` (5) ·
`WEBHOOK_TOLERANCE_SECONDS` (300) · the `RATE_LIMIT_*` family.

Fee schedules and risk policies are **database rows**, not environment variables —
they are versioned, audited, and editable without a deploy.

---

## Production readiness

### Infrastructure

- [ ] Managed PostgreSQL, multi-AZ, encrypted at rest, PITR enabled
- [ ] **Restore tested** — an untested backup is not a backup
- [ ] Redis for rate limiting and idempotency (both are on PostgreSQL today)
- [ ] TLS termination with HSTS preload
- [ ] CDN with WAF and DDoS protection
- [ ] Private networking; the database is never publicly reachable
- [ ] Secrets in a managed store with automatic rotation
- [ ] Container image scanning in CI

### Application

- [ ] `DEMO_MODE=false` and every provider replaced
- [ ] **Remove the demo-mode MFA bypass for staff**
- [ ] **Remove the password-reset token console log**
- [ ] A real notification transport (nothing is delivered today)
- [ ] Scheduled jobs: expire codes, expire quotes, flush notifications, prune
      rate-limit counters and idempotency keys, reset location daily capacity
- [ ] A versioned pickup pepper with dual-read, so rotation does not invalidate
      live codes
- [ ] Structured logging with request correlation
- [ ] Error tracking with PII scrubbing

### Observability — the four alerts that matter

1. **Ledger imbalance.** `verifyLedgerIntegrity()` returning `balanced: false`
   is a page-someone event. Money is unaccounted for.
2. **Negative custodial balance.** A `LIAB_*` custodial account below zero means
   the books claim we hold less than nothing on someone's behalf.
3. **Chargeback rate crossing threshold.** The business model depends on this
   number.
4. **Failed pickup verifications spiking.** Either an attack or a broken
   integration; both need immediate attention.

Ship the audit stream somewhere that alerts. Audit logs written and never watched
are evidence, not detection.

### Compliance and legal

- [ ] **Licensing resolved** — see [`LEGAL_AND_COMPLIANCE.md`](./LEGAL_AND_COMPLIANCE.md)
- [ ] Acquirer boarded with the correct merchant category
- [ ] PCI DSS scope confirmed with a QSA (SAQ-A is the likely target)
- [ ] Independent penetration test
- [ ] Signed payout partner agreements
- [ ] Real KYC and sanctions vendors contracted
- [ ] Compliance officer appointed; programme documented
- [ ] Incident response plan with breach notification paths
- [ ] Data retention policy set by counsel

---

## Migrations in production

```bash
npx prisma migrate deploy    # apply only — never `migrate dev`
```

Run before the new application version starts. Use **expand and contract** for
anything destructive: add the column, backfill, switch reads, switch writes, drop
the old column in a later release. A migration that drops a column holding
financial history is not undone by a rollback.

---

## Scaling notes

The application layer is stateless and scales horizontally. Three things do not:

1. **Rate limiting and idempotency** write to PostgreSQL on every request. This is
   the first bottleneck. Move to Redis.
2. **Pickup redemption** runs at `SERIALIZABLE`, so contention on a single code
   serialises. That is intentional and correct — it is what guarantees one
   payout — but it means retry-on-serialisation-failure must be handled at the
   edge.
3. **Admin aggregates** scan `transactions`. Beyond a few million rows they need
   materialised views or a read replica.

---

## Rollback

Application: deploy the previous image.

Database: **do not roll a migration back automatically.** Prefer a forward fix.
If a rollback is unavoidable, verify no financial rows depend on the dropped
structure before proceeding — restoring from backup loses every transaction since
the snapshot, which is worse than the bug in almost every case.
