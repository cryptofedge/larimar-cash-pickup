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
