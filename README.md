<div align="center">

# Larimar

**Get Dominican pesos without using your card at an ATM.**

*Your digital cash bridge while traveling.*

</div>

---

> ## ⚠️ This is a technical demonstration, not a financial service
>
> Larimar is **not** a licensed money transmitter, payment institution, remittance
> provider, or foreign-exchange dealer — in the Dominican Republic or anywhere else.
>
> It **moves no real money**. Every payment, exchange rate, identity check, and
> sanctions screen is simulated. Every pickup location is **fictional**; no bank,
> exchange house, or payout network has any relationship with this project.
>
> Do not submit real card details, real identity documents, or passwords you use
> elsewhere. See [`docs/LEGAL_AND_COMPLIANCE.md`](docs/LEGAL_AND_COMPLIANCE.md).

---

## What it is

A traveler in the Dominican Republic needs pesos. Their options are a hunt for a
compatible ATM, stacked withdrawal fees, a dynamic-currency-conversion prompt
accepted under time pressure, and their physical card going into an unfamiliar
machine — repeatedly.

Larimar collapses that into **one card-not-present payment on their own phone**,
at a price shown in full beforehand, producing a **pickup code** redeemed for cash
at an authorised location.

```
Enter RD$20,000  →  See the exact USD total  →  Pay  →  DR-4829-7316
                 →  Show code + passport     →  Collect RD$20,000
```

This repository is the **technical foundation** for that product: a complete,
working, tested full-stack implementation with every external financial provider
behind a replaceable interface.

---

## Quick start

**Requirements:** Node 20+, Docker, and about three minutes.

```bash
git clone <this-repo> larimar && cd larimar
npm install
```

```bash
cp .env.example .env
```

Generate real secrets (the app refuses to boot with the placeholders):

```bash
node -e "const f=require('fs'),c=require('crypto');let t=f.readFileSync('.env','utf8');t=t.replace(/replace-me-with-openssl-rand-base64-32/g,()=>c.randomBytes(32).toString('base64'));f.writeFileSync('.env',t);console.log('secrets generated')"
```

Start the database, apply migrations, and seed demo data:

```bash
npm run db:up && npm run db:migrate && npm run db:seed
```

Run it:

```bash
npm run dev
```

Open **http://localhost:3000**.

### See the whole thing work in one command

```bash
npm run demo
```

Drives the real services against the real database: pricing → risk → KYC →
payment → ledger → code issuance → agent verification → disbursement → ledger
integrity, asserting ~20 properties along the way.

---

## Demo credentials

Password for every account: **`DemoPass123!`**

| Email | Role | What they can do |
| --- | --- | --- |
| `customer@example.com` | `CUSTOMER` | Request pesos, pay, hold a pickup code |
| `agent@example.com` | `PICKUP_AGENT` | Verify codes and disburse cash **at Punta Cana only** |
| `manager@example.com` | `PICKUP_MANAGER` | Agent powers plus location administration |
| `compliance@example.com` | `COMPLIANCE_ANALYST` | Place and release holds, review KYC |
| `support@example.com` | `SUPPORT_AGENT` | Read transactions — **cannot** approve payouts |
| `finance@example.com` | `FINANCE_ADMIN` | Refunds, ledger, pricing |
| `admin@example.com` | `SYSTEM_ADMIN` | Configuration — **cannot** clear compliance holds |

> Staff accounts skip the TOTP challenge while `DEMO_ALLOW_MFA_BYPASS=true`, so
> the platform is walkable from a fresh clone. The process prints a loud warning
> at startup listing every insecure shortcut that is active. Both shortcut flags
> are production blockers, listed as such in [`SECURITY.md §12`](docs/SECURITY.md).

### Walk the full demo by hand

1. Sign in as `customer@example.com` → **New cash pickup** → request **RD$5,000**
   (under the KYC threshold) → pick a location → **Confirm & Pay**.
2. Copy the pickup code. **It is shown exactly once** — it is not stored in any
   recoverable form.
3. Sign out. Sign in as `agent@example.com` → paste the code → **Verify**.
4. Note what the agent sees: amount, ID requirements, compliance flag. No name,
   no email, no card, no funding amount.
5. Tick the identity confirmation → **Approve pickup**.
6. Sign in as `admin@example.com` → the transaction is `PICKED_UP` and the ledger
   still balances.

Try **RD$20,000** to trigger the identity-verification gate, and the decline
scenarios in the payment step to exercise the failure paths.

---

## Architecture in one page

```
PRESENTATION   src/app, src/components      React Server Components, i18n. No arithmetic.
HTTP           src/app/api                  Zod parsing, authn, authz, rate limit, idempotency.
SERVICES       src/server/services          Use cases inside DB transactions.
DOMAIN         src/lib/domain               Money, FX, fees, state machine, codes, risk, ledger.
                                            Pure. No I/O. No clock. 296 tests, no infrastructure.
PORTS          src/server/providers         Payment · FX · KYC · Sanctions · Notifications
PERSISTENCE    prisma/schema.prisma         PostgreSQL 16. Constraints enforce the invariants too.
```

Dependencies point downward only. `src/lib/domain` imports nothing from
`src/server` or `src/app` — which is why the financial core is testable without a
database, a network, or a clock.

Five decisions that shape everything else:

1. **Money is `bigint` minor units.** `RD$20,000.00` is `2000000n`. There is no
   `number` anywhere in the pricing path, because IEEE-754 cannot represent
   `0.1 + 0.2` and has no business in a system promising an exact payout.
2. **The server is the only authority.** A client sends the amount it wants and a
   location. Rates, fees, totals, risk scores, and statuses are all computed
   server-side from database rows.
3. **Balances are never stored.** They are the sum of ledger entries. Corrections
   are reversing entries; nothing is updated or deleted.
4. **Status changes only via the state machine.** A declarative matrix of legal
   transitions *and* the actor types permitted to traverse each one.
5. **The country is configuration.** Nothing in money, fx, fees, ledger, codes, or
   the state machine mentions the Dominican Republic.

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## The pickup code

A bearer instrument for cash, treated as one:

| Property | Value |
| --- | --- |
| Format | `DR-XXXX-XXXX`, 32-symbol alphabet with no I, L, O, or U |
| Entropy | **40 bits** — 1,099,511,627,776 combinations |
| Generation | `crypto.randomBytes` with rejection sampling (no modulo bias) |
| Second factor | 128-bit secret, QR payload only |
| Third factor | Government-issued ID checked at the window |
| At rest | `sha256(pepper ‖ code)` — the pepper is not in the database |
| Delivered | Once, to the paying customer. No endpoint returns it again. |
| Attempts | 5, then locked plus a fraud alert. Cross-code brute force also detected. |
| Redemption | Single-use, enforced by a conditional update at `SERIALIZABLE` |
| Collection delay | Risk-based hold before a code becomes collectable — 30 min at MEDIUM+, none for low risk. Enforced at verify **and** redeem. |

---

## Test results

```
Unit          296 passed    domain logic, zero infrastructure, ~2s
Integration    65 passed    real PostgreSQL: concurrency, constraints, RBAC, limits
E2E            28 passed    Playwright, desktop + mobile, full browser journeys
              ───────────
              389 passed
```

```bash
npm test            # unit only — fast, no infrastructure
npm run test:all    # unit + integration (needs the database)
npm run test:e2e    # Playwright (builds and serves the app)
npm run typecheck && npm run lint
```

Four findings the tests produced, all now fixed and guarded:

- **A rejected-KYC transaction could reach `PICKED_UP`.** An exhaustive
  reachability test found a path `KYC_REJECTED → CANCELLED → REFUNDED →
  DISPUTED → PICKED_UP`. The `REFUNDED → DISPUTED` edge was wrong; `REFUNDED` is
  now the single absorbing state.
- **A strict CSP broke the entire application.** `script-src 'self'` blocked
  Next's inline RSC payload, so nothing hydrated and every page rendered blank.
  Typecheck and build both passed. Fixed with a per-request nonce in middleware
  rather than by weakening the policy.
- **A refund drove a custodial account negative.** Refunds debited the customer-
  funds suspense account after those funds were already allocated to fees and FX.
  The ledger still balanced; it was simply wrong. Refunds now reverse the
  original posting chain.
- **A fraud control was enforced at verification but not at redemption.** The
  risk-based collection delay blocked `verify` while `redeem` sailed straight
  through — so an agent calling redeem directly bypassed it entirely. Redemption
  now re-applies every guard rather than trusting the earlier verify call.

---

## Documentation

| Document | What is in it |
| --- | --- |
| [`PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md) | Brand, persona, scope, flows, business model, risks |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering, money representation, state machine, ledger, ports |
| [`SECURITY.md`](docs/SECURITY.md) | Threat model, controls, and an honest list of what is missing |
| [`LEGAL_AND_COMPLIANCE.md`](docs/LEGAL_AND_COMPLIANCE.md) | Every licensing, banking, and partnership dependency |
| [`API.md`](docs/API.md) | Endpoints, conventions, error codes, examples |
| [`DATABASE.md`](docs/DATABASE.md) | Schema, invariants, indexing, retention |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Local, Docker, and production readiness |
| [`FRAUD_AND_RISK.md`](docs/FRAUD_AND_RISK.md) | Attack catalogue and the control for each |
| [`PARTNER_INTEGRATION.md`](docs/PARTNER_INTEGRATION.md) | How a payout institution integrates |

OpenAPI 3.1 is generated from the same Zod schemas the API validates with:

```bash
npm run openapi   # → public/openapi.json
```

---

## What is mocked, and what production needs

| Concern | Demo | Production requires |
| --- | --- | --- |
| Payments | `MockPaymentProvider` — declines, 3-DS, webhooks, refunds | A PCI-DSS Level 1 acquirer that will board this merchant category |
| Exchange rates | Deterministic pseudo-rates, labelled `isDemoRate` everywhere | A licensed market feed plus the platform's own funding cost |
| KYC | `MockKycProvider` — surname triggers, no real check | Document authentication and biometric liveness |
| Sanctions | Four fixture strings | OFAC, UN, EU, UK HMT, local lists, fuzzy matching |
| Notifications | Outbox rows, logged only | Per-channel vendors |
| Payout network | 10 fictional locations, all flagged `isDemo` | Signed agreements, float management, settlement |
| Rate limit / idempotency | PostgreSQL | Redis |
| Secrets | Environment variables | KMS with rotation |

---

## Known limitations

- **Partial refunds are refused.** Apportioning a partial return across the
  platform fee, processing fee, FX spread, and principal is a commercial policy
  decision, not an engineering one. Guessing would balance the ledger while
  misstating revenue, so the service refuses and says why.
- **MFA is bypassed for staff** while `DEMO_ALLOW_MFA_BYPASS=true`, and
  **password reset tokens are logged to the console** while
  `DEMO_LOG_RESET_TOKENS=true`. Each is a separate named flag rather than being
  folded into `DEMO_MODE`, and the process prints a loud warning at startup
  listing whichever are active. Both must be `false` in production.
- **Device fingerprinting is a placeholder** and trivially spoofable. It
  contributes risk weight and is never an authentication factor.
- **Rate limiting uses fixed windows** in PostgreSQL, so a burst at a window
  boundary is possible.
- **No settlement file generation, reconciliation engine, or float management.**
- **Single region, no disaster-recovery topology.**
- **Not penetration tested. No PCI DSS assessment.**

---

## Recommended next steps

**Before anything else:** engage Dominican financial-services counsel. Every
downstream decision depends on whether this is a regulated activity and, if so,
under which category. See [`LEGAL_AND_COMPLIANCE.md §9`](docs/LEGAL_AND_COMPLIANCE.md).

**Engineering, in priority order:**

1. Set `DEMO_ALLOW_MFA_BYPASS=false` and `DEMO_LOG_RESET_TOKENS=false`, then
   delete both branches once a real MFA enrolment and mail transport exist.
2. Move rate limiting and idempotency to Redis.
3. Move secrets to a managed store with rotation, including a versioned pickup
   pepper with dual-read so rotation does not invalidate live codes.
4. Decide the partial-refund policy and implement the apportionment.
5. Build settlement: partner reconciliation, float telemetry, settlement files.
6. Replace the mock providers one at a time behind the existing interfaces.
7. Independent penetration test and PCI scoping.
8. Observability: ship the audit stream somewhere that alerts.

**Product:**

1. Validate the chargeback rate assumption — the unit economics depend on it.
2. Test the payout-window experience with real agents; that screen is used under
   time pressure with a customer waiting.
3. Model float requirements per location before promising availability.

---

## Project layout

```
prisma/            schema.prisma · migrations · seed
scripts/           demo-flow · generate-openapi · reset-rate-limits
src/
  app/             (marketing) (auth) (app) agent/ admin/ api/
  components/      brand · ui · layout · transaction · agent · admin · kyc
  content/         faq · legal
  i18n/            locale resolution + typed en/es catalogues
  lib/
    domain/        money · fx · fees · transaction-state · pickup-code
                   risk · ledger · countries · errors      (pure)
    validation/    Zod schemas shared by the API and OpenAPI
  server/
    auth/          password · session · totp · rbac · crypto
    providers/     payment · exchange-rate · kyc · notifications
    services/      transaction · payment · pickup · compliance · ledger
                   pricing · admin · auth · audit · notification
    http/          api wrapper · idempotency · rate limiting
    partner/       HMAC request signing
  middleware.ts    CSP nonce and security headers
tests/
  unit/            domain, no infrastructure
  integration/     real PostgreSQL
  e2e/             Playwright
docs/
```

---

## Brand

**Larimar** is a pale blue pectolite found in commercially viable quantities in
exactly one place on earth: the Bahoruco mountains of Barahona province,
Dominican Republic. Unmistakably Dominican, pronounceable on sight by an English,
Spanish, French, or German speaker, and containing *mar* — the sea. It reads as a
bank or an insurer, which is the register a cash-handling platform needs.

The mark is two nested arcs forming an **L** that also reads as a bridge span over
water. The arcs never close; the negative space is the crossing. Drawn as live
SVG in `src/components/brand/Logo.tsx`.

Deep Navy `#0A1F33` · Larimar `#1C93B8` · Pale Larimar `#CFE9F1` · Sand `#E8B24A`

---

<div align="center">

**Larimar is a demonstration. No real money moves. All locations are fictional.**

</div>
