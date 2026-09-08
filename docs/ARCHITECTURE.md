# Larimar — Architecture

**Status:** v0.1 foundation · **Mode:** DEMO (all external financial providers simulated)

---

## 1. Architectural goals

This system moves cash to a stranger in another country on the strength of a short code.
That single sentence drives every structural decision below.

1. **The server is the only authority on money.** No amount, rate, fee, status, or payout
   decision may originate from a client. The browser is a rendering surface.
2. **Every financial fact is derivable from an append-only record.** Balances are computed
   from ledger entries, not stored and mutated. State history is events, not overwrites.
3. **External financial providers are replaceable.** Payments, FX, KYC, sanctions, and
   notifications sit behind interfaces. The mock implementations and a future real
   implementation are peers; the domain never learns which is installed.
4. **The country is configuration, not code.** The Dominican Republic is the first market,
   not a hardcoded assumption.
5. **Least privilege at every boundary.** A payout agent sees the minimum data needed to
   hand over cash and nothing else.

---

## 2. Layering

```
┌──────────────────────────────────────────────────────────────────────┐
│  PRESENTATION            src/app/**  ·  src/components/**            │
│  React Server Components, forms, i18n. No financial arithmetic.      │
├──────────────────────────────────────────────────────────────────────┤
│  HTTP / API              src/app/api/**                              │
│  Zod parsing, authn, authz, rate limiting, idempotency, error shape. │
├──────────────────────────────────────────────────────────────────────┤
│  APPLICATION SERVICES    src/server/services/**                      │
│  Use-case orchestration inside DB transactions. The only layer that  │
│  composes domain + ledger + providers + audit together.              │
├──────────────────────────────────────────────────────────────────────┤
│  DOMAIN (pure)           src/lib/domain/**                           │
│  Money, FX, fee engine, state machine, pickup codes, risk scoring.   │
│  No I/O. No Prisma. No Date.now() without injection. Fully testable. │
├──────────────────────────────────────────────────────────────────────┤
│  PORTS                   src/server/providers/**                     │
│  PaymentProvider · ExchangeRateProvider · KycProvider ·              │
│  SanctionsProvider · NotificationTransport                           │
├──────────────────────────────────────────────────────────────────────┤
│  PERSISTENCE             prisma/schema.prisma · src/server/db.ts     │
│  PostgreSQL 16. Prisma. Constraints enforce invariants the app also  │
│  enforces — belt and braces.                                         │
└──────────────────────────────────────────────────────────────────────┘
```

The dependency rule points downward only. `src/lib/domain` imports nothing from
`src/server` or `src/app`. That is what makes the financial core testable without a
database, a network, or a clock — and it is why the fee, FX, state-machine, ledger, and
pickup-code tests run in milliseconds with no infrastructure.

---

## 3. Money representation

**All monetary values are `bigint` counts of minor units, paired with an ISO-4217 code.**

`RD$20,000.00` is `{ amount: 2000000n, currency: "DOP" }`. `$1.00 USD` is
`{ amount: 100n, currency: "USD" }`. Currency exponents come from a table
(`src/lib/domain/money.ts`), because not every currency is 2-decimal.

There is no `number` anywhere in the pricing path. IEEE-754 doubles cannot represent
`0.1 + 0.2` and have no place in a system that promises "you will receive exactly
RD$20,000."

**Rounding is explicit and directional.** Every rounding site names its mode. Fees round
**half-up** (against the customer, disclosed). The funding amount required to deliver a
fixed payout rounds **up** (ceiling), so the platform is never short of the payout it
promised. `Money.allocate()` distributes a total across parts without losing or inventing
minor units — the classic remainder-distribution algorithm.

**Exchange rates are scaled integers.** A rate is stored as an integer numerator with a
fixed scale of 10^8 (`RATE_SCALE`). `1 USD = 60.25 DOP` is `6025000000n`. Conversion is
integer multiply then divide with an explicit rounding mode. No float ever touches a rate.

---

## 4. Transaction state machine

Sixteen states, and a transition is legal only if the matrix says so. The matrix lives in
`src/lib/domain/transaction-state.ts` as data, and the service layer is physically unable
to write a status without going through `assertTransition()`.

```
                        CREATED
                           │
              CUSTOMER_DETAILS_REQUIRED
                           │
                     KYC_REQUIRED ──▶ KYC_PENDING ──┬──▶ KYC_REJECTED ─▶ CANCELLED
                           │                        │
                           └──────── KYC_APPROVED ◀─┘
                                          │
                                   PAYMENT_PENDING
                                    │           │
                    PAYMENT_AUTHORIZED         PAYMENT_FAILED ─▶ CANCELLED
                          │      │
                          │      └──▶ COMPLIANCE_REVIEW ──┬──▶ READY_FOR_PICKUP
                          │                               └──▶ CANCELLED / REFUNDED
                          ▼
                   READY_FOR_PICKUP
                     │      │     │
       PARTIALLY_PICKED_UP  │    EXPIRED ─▶ REFUNDED
                     │      │
                     └──▶ PICKED_UP
                              │
                          DISPUTED ─▶ REFUNDED
```

`REFUNDED` is the single absorbing state — the money is back with the customer and the
transaction is closed. `DISPUTED` is reachable **only** from `PICKED_UP`, because a
chargeback can arrive after the cash is gone; that is the defining risk of this product and
the model must admit it.

**A soundness property the tests enforce.** No closed-out state (`KYC_REJECTED`,
`CANCELLED`, `EXPIRED`, `REFUNDED`) may have *any* path to a disbursement state
(`READY_FOR_PICKUP`, `PARTIALLY_PICKED_UP`, `PICKED_UP`). An earlier revision of this matrix
allowed `REFUNDED → DISPUTED`, which combined with `CANCELLED → REFUNDED` and
`DISPUTED → PICKED_UP` to open a path from `KYC_REJECTED` all the way to cash disbursed. The
exhaustive reachability test in `tests/unit/transaction-state.test.ts` caught it, and the
regression guard is now permanent. A post-refund chargeback is recorded on the `Chargeback`
entity rather than by reopening a closed transaction.

Every transition writes a `TransactionEvent` row: from-state, to-state, actor, reason,
metadata, timestamp. The `transactions.status` column is a materialised convenience; the
event stream is the truth.

---

## 5. The pricing pipeline

Given a requested payout of RD$20,000:

```
1. Fetch mid-market rate           USD→DOP from ExchangeRateProvider     (cached, sourced, timestamped)
2. Apply FX spread                 effectiveRate = mid × (1 − spreadBps/10000)
3. Convert payout → principal      principal = ceil(payoutMinor × RATE_SCALE / effectiveRate)
4. Platform fee                    max(principal × platformBps/10000, platformFeeMin)
5. Processing fee                  (principal + platformFee) × procBps/10000 + procFixed
6. Total charged                   principal + platformFee + processingFee
7. Freeze                          persist a Quote row with every input, output, and an expiry
```

The customer sees all seven outputs. The quote is stored with the **rate id**, the **fee
schedule version**, and an **expiry**. At authorisation the service re-reads the quote; if
it has expired, or if the live rate has drifted beyond the configured tolerance, the
transaction is refused and a fresh quote must be confirmed. This is the mechanism behind
the promise "you will receive exactly RD$20,000."

Fee schedules are **versioned rows**, not constants. Changing pricing creates a new version;
historical transactions keep pointing at the version that priced them, so every past
receipt can be recomputed and defended.

---

## 6. Double-entry ledger

Balances are never stored. They are the sum of entries.

Accounts are typed (`ASSET`, `LIABILITY`, `REVENUE`, `EXPENSE`) and normal-balanced. Every
posting creates one `LedgerTransaction` with two or more `LedgerEntry` rows whose signed
minor units sum to exactly zero, in a single currency. `postLedgerTransaction()` refuses an
unbalanced set before it reaches the database, and the schema's unique constraints prevent
double-posting the same business event.

Worked example, RD$20,000 payout funded by $342.11 USD:

| Event | Debit | Credit |
| --- | --- | --- |
| `CUSTOMER_PAYMENT` | Processor receivable (asset) | Customer funding suspense (liability) |
| `PLATFORM_FEE` | Customer funding suspense | Fee revenue (revenue) |
| `PROCESSING_FEE` | Processing cost (expense) | Processor receivable |
| `FX_CONVERSION` | USD funding suspense | DOP payout liability, at the effective rate |
| `PAYOUT_LIABILITY` | — | Payout obligation to customer (liability) |
| `BANK_SETTLEMENT` | Payout obligation | Partner settlement payable |
| `REFUND` / `CHARGEBACK` | Reversing entries, never deletions | |

Corrections are **reversing entries**. Nothing in the ledger is ever updated or deleted.

---

## 7. Pickup credential security

The pickup code is a bearer credential for cash. It is treated like one.

- **Format:** `DR-####-####` — a country prefix plus 8 digits, which is
  10^8 ≈ 2^26.6 of keyspace in the human-typed portion. To reach the required entropy the
  code is generated from `crypto.randomBytes` via rejection sampling (no modulo bias), and
  the raw code is paired with a 128-bit `codeSecret` embedded only in the QR payload.
  The typed code is therefore *not* the whole credential — it is one factor, combined with
  the customer's government ID at the window.
- **At rest:** only `sha256(pepper ‖ code)` is stored. The plaintext exists in the response
  to the owning customer and nowhere else. An attacker with a database dump cannot redeem.
- **Lookup:** by hash, so verification is an indexed equality match, not a scan.
- **Attempt limiting:** failed verifications are counted per code *and* per agent *and* per
  IP. Exceeding the per-code limit locks the code and opens a `FraudAlert`. This is what
  makes the 8-digit typed portion safe: guessing is bounded to a handful of attempts, not
  10^8.
- **Expiry:** codes expire (default 30 days, configurable per country) and expiry is checked
  server-side on every verification.
- **Single use:** redemption is guarded by a conditional update inside a serialisable
  transaction. Two agents scanning simultaneously produce exactly one payout.
- **No PII:** the code and the QR payload contain no name, email, phone, or card data.

---

## 8. Provider ports

| Port | Interface | Demo implementation | Production candidates |
| --- | --- | --- | --- |
| Payments | `PaymentProvider` | `MockPaymentProvider` | Any PCI-DSS Level 1 acquirer that supports DR-facing merchants and cash-out MCCs — subject to legal review |
| FX rates | `ExchangeRateProvider` | `MockExchangeRateProvider` | A licensed market-data feed plus the platform's own funding desk |
| KYC | `KycProvider` | `MockKycProvider` | A document-and-biometric vendor with DR coverage |
| Sanctions/PEP | `SanctionsProvider` | `MockSanctionsProvider` | A screening vendor covering OFAC, UN, EU, and DR lists |
| Notifications | `NotificationTransport` | `MockEmail/Sms/WhatsApp/Push` | Per-channel vendors |

`PaymentProvider` is the important one:

```ts
interface PaymentProvider {
  createPayment(input): Promise<PaymentIntentResult>;
  authorizePayment(input): Promise<PaymentAuthorizationResult>;
  capturePayment(input): Promise<PaymentCaptureResult>;
  refundPayment(input): Promise<PaymentRefundResult>;
  getPaymentStatus(providerRef): Promise<PaymentStatusResult>;
  verifyWebhookSignature(raw, headers): boolean;
  parseWebhook(raw): PaymentWebhookEvent;
}
```

**No card data crosses our boundary.** The demo simulates a hosted-field / tokenisation
handoff: the client receives a client secret, exchanges card details with the provider
directly, and hands us an opaque token. `MockPaymentProvider` deliberately mimics this
shape — including declines, 3-D Secure challenge, and asynchronous webhook confirmation —
so that swapping in a real provider is an implementation change, not a redesign. See
[`PARTNER_INTEGRATION.md`](./PARTNER_INTEGRATION.md).

---

## 9. Identity, sessions, and access control

- **Passwords:** `scrypt` (N=2^15, r=8, p=1) from `node:crypto`, per-password 16-byte salt,
  timing-safe comparison, versioned encoded string so parameters can be upgraded in place.
  No native dependency, no unmaintained pure-JS bcrypt.
- **Sessions:** opaque 256-bit random tokens, stored **hashed**, delivered in an
  `HttpOnly; Secure; SameSite=Lax` cookie. Absolute and idle expiry. Rotation on privilege
  change. Server-side revocation, individually and en masse.
- **MFA:** RFC 6238 TOTP implemented on `node:crypto` HMAC-SHA1 with a ±1 step window,
  plus single-use recovery codes stored hashed. Required for every staff role.
- **RBAC:** seven roles mapped to explicit permission strings, checked server-side on every
  privileged route. The check is centralised in `src/server/auth/rbac.ts`; routes declare
  the permission they need.

| Role | Can do | Explicitly cannot |
| --- | --- | --- |
| `CUSTOMER` | Own transactions only | Touch any staff surface |
| `PICKUP_AGENT` | Verify and redeem codes **at their assigned location** | See customer PII beyond ID requirements; act at other locations |
| `PICKUP_MANAGER` | Agent powers plus location administration and reversal escalation | Approve compliance holds |
| `COMPLIANCE_ANALYST` | Place/release holds, review KYC, resolve alerts | Move money or issue refunds |
| `SUPPORT_AGENT` | Read transactions, add notes, open tickets | **Approve payouts**, change status, view full PII |
| `FINANCE_ADMIN` | Refunds, ledger review, settlement, pricing configuration | Change user roles |
| `SYSTEM_ADMIN` | Configuration, user and role administration | Approve their own compliance cases (separation of duties) |

Authorisation is deny-by-default: a route with no declared permission is unreachable by any
non-admin principal.

---

## 10. Idempotency and concurrency

Every mutating financial endpoint accepts an `Idempotency-Key` header. The key, the route,
the actor, and a hash of the request body form a unique row. A replay with the same key and
the same body returns the **stored original response**; a replay with the same key and a
*different* body is rejected with `409`. This is what makes a customer double-tapping
"Confirm & Pay" on flaky hotel Wi-Fi safe.

Concurrency-sensitive operations — code redemption, payment capture, state transitions —
run inside `SERIALIZABLE` database transactions with conditional updates that assert the
expected prior state. The database, not application logic, is the final arbiter.

---

## 11. Risk and compliance pipeline

On transaction creation and again before `READY_FOR_PICKUP`, `evaluateRisk()` runs a set of
pure, individually testable rules producing weighted signals:

amount thresholds · daily/monthly limit consumption · velocity (count and value over
rolling windows) · new-account age · device fingerprint reuse across accounts · IP/BIN
country mismatch versus payout country · impossible-travel heuristics · sanctions/PEP hits ·
prior chargeback history · pickup-location risk tier.

Signals aggregate to a 0–100 score bucketed `LOW / MEDIUM / HIGH / CRITICAL`. `HIGH` and
above route the transaction to `COMPLIANCE_REVIEW` automatically and open a
`ComplianceCase`. Thresholds, weights, and limits are database rows, editable by
`SYSTEM_ADMIN`, versioned, and audited.

Demo limits ship at **$1,000/day and $5,000/month**. These are **arbitrary engineering
defaults**, not Dominican legal thresholds. Real thresholds must be set by qualified
counsel and the eventual licensed partner.

---

## 12. Internationalisation

Dictionaries in `src/i18n/messages/{en,es}.ts` typed against the English keyset, so a
missing Spanish key is a **compile error**, not a runtime `undefined`. Locale resolves from
an explicit user choice, then a cookie, then `Accept-Language`, defaulting to `en` for the
traveler audience. Currency and date formatting go through `Intl` with the active locale;
DOP renders as `RD$20,000.00` in both locales because that is how the currency is written
in the Dominican Republic.

---

## 13. Country configuration

`src/lib/domain/countries.ts` defines each market: payout currency, accepted funding
currencies, payout methods, limits, code prefix and expiry, ID requirements, fee schedule
key, and regulatory notes. The Dominican Republic is fully configured; Mexico, Colombia,
Costa Rica, Panama, Jamaica, and Puerto Rico are scaffolded and disabled. Nothing in the
pricing, ledger, code, or state-machine modules mentions the DR.

---

## 14. Request lifecycle (worked example)

`POST /api/transactions` with `Idempotency-Key: abc-123`:

1. **Middleware** — security headers, request id, locale resolution.
2. **Rate limit** — per IP and per user on a fixed-window counter.
3. **Session** — cookie to hashed lookup to user, expiry and revocation checks.
4. **Authorise** — `transaction:create` permission required.
5. **Validate** — Zod parse; unknown fields rejected.
6. **Idempotency** — hit returns the stored response; miss reserves the key.
7. **Service** — inside one DB transaction: re-price the quote server-side, evaluate risk
   and limits, create the transaction, write the opening event, post ledger entries, queue
   notifications, write the audit record.
8. **Respond** — DTO shaped for the caller's role; store the response against the key.

Any thrown domain error maps to a stable error code and an HTTP status through one
translator, so the client never sees a stack trace or a raw database message.

---

## 15. Repository layout

```
prisma/          schema.prisma, migrations, seed
scripts/         demo-flow, openapi generation
src/
  app/           routes: (marketing) (auth) (customer) agent/ admin/ api/
  components/    brand, ui, layout, marketing, transaction
  i18n/          locale resolution + typed en/es dictionaries
  lib/
    domain/      money · fx · fees · transaction-state · pickup-code · risk ·
                 ledger · countries · errors        (pure, no I/O)
    validation/  Zod schemas shared by API and OpenAPI generation
  server/
    auth/        password · session · totp · rbac
    providers/   payment · exchange-rate · kyc · sanctions · notifications
    services/    transaction · payment · pickup · compliance · ledger · admin
    http/        api handler, idempotency, rate limit, errors, audit
tests/
  unit/          domain logic, zero infrastructure
  integration/   services against a real PostgreSQL
  e2e/           Playwright, full browser journeys
docs/            this file and its siblings
```

---

## 16. Deliberate limitations of v0.1

Documented honestly rather than hidden:

- Rate limiting and idempotency use the database. Production needs Redis.
- Secrets come from environment variables. Production needs a KMS with rotation.
- The mock FX provider generates plausible rates deterministically from a seed. It is
  **not** market data and must never be presented as such.
- No settlement-file generation, reconciliation engine, or float management.
- Notifications write to an outbox table and log; nothing is delivered.
- Sanctions screening matches against a tiny fixture list, not a real sanctions database.
- Single-region deployment; no DR/BCP topology.

See [`README.md` §Known limitations](../README.md) for the full list.
