# Larimar — Database Design

**PostgreSQL 16** · Prisma ORM · schema in [`prisma/schema.prisma`](../prisma/schema.prisma)

---

## The three conventions that matter

### 1. Money is `BigInt` minor units

Every monetary column is a `BigInt` count of the currency's smallest unit, paired
with an ISO-4217 code. `RD$20,000.00` is `2000000` with `"DOP"`.

Not `NUMERIC`, not `DECIMAL`, and emphatically not `DOUBLE PRECISION`. `NUMERIC`
would be defensible, but integers make the invariant enforceable in the type
system all the way up through the application: `bigint` in TypeScript cannot be
accidentally mixed with `number`, whereas a decimal library type can be
`.toNumber()`'d by a tired developer at 2am.

Exchange rates are `BigInt` scaled by 10^8. `1 USD = 60.25 DOP` is `6025000000`.

### 2. Financial rows are append-only

`transaction_events`, `ledger_entries`, `ledger_transactions`, `pickup_events`,
`audit_logs`, `risk_events`, and `webhook_events` are never updated or deleted by
the application. Corrections are new rows: a reversing ledger transaction, a
later status event.

`transactions.status` is a **materialised convenience**. The event stream is the
truth, and the two are written in the same database transaction so they cannot
drift.

### 3. Constraints enforce what the application also enforces

Belt and braces, deliberately. The application checks a rule; the database
refuses to store a violation of it. Neither is trusted to be the only guard.

---

## Entity map

```
users ─┬─ user_profiles (1:1)
       ├─ user_roles ──── roles ──── role_permissions ──── permissions
       ├─ sessions ────── devices
       ├─ mfa_recovery_codes · password_reset_tokens
       ├─ identity_verifications
       ├─ agent_location_assignments ──── pickup_locations
       └─ transactions ─┬─ quotes ─┬─ exchange_rates
                        │          └─ fee_schedules
                        ├─ transaction_events        (append-only)
                        ├─ payments ─┬─ payment_attempts
                        │            ├─ refunds
                        │            └─ chargebacks
                        ├─ pickup_codes (1:1)
                        ├─ pickup_events             (append-only)
                        ├─ ledger_transactions ──── ledger_entries ──── ledger_accounts
                        ├─ compliance_cases · risk_events · fraud_alerts
                        └─ notifications · support_tickets

pickup_institutions ──── pickup_locations
Infrastructure: audit_logs · webhook_events · idempotency_keys
                rate_limit_counters · platform_settings · risk_policies
```

31 tables.

---

## Tables that carry the important invariants

### `transactions`

The spine. Amounts are denormalised from the quote so a transaction row is
self-describing in reports without a join.

```
reference          TEXT UNIQUE      LRM-7F3K2Q8M — random, not sequential
status             ENUM             17 states; only written via the state machine
quote_id           UUID UNIQUE      one quote, one transaction
payout_amount_minor  BIGINT         what the customer collects
paid_out_minor       BIGINT         supports partial disbursement
total_charged_minor  BIGINT         what the card was charged
effective_rate       BIGINT         scaled 1e8, pinned at quote time
risk_score, risk_level              the assessment at creation
```

Indexes: `(user_id, created_at)`, `(status, created_at)`, `(risk_level, status)`,
`(pickup_location_id, status)`, `(created_at)`.

`reference` is random because a sequential identifier leaks volume to anyone
holding two of them.

### `quotes`

An immutable frozen price. Stores every input *and* every output — payout,
principal, each fee, both rates, the spread — plus foreign keys to the exact
`exchange_rates` row and `fee_schedules` version that produced it.

That is what makes a receipt defensible years later: it can be recomputed from
the stored inputs and shown to match.

`consumed_at` enforces single use.

### `fee_schedules` — versioned, never edited

`UNIQUE (key, version)`. Changing pricing creates a new version; historical
transactions keep pointing at the version that priced them. Editing a schedule in
place would silently rewrite the arithmetic of every past receipt.

### `pickup_codes`

```
code_hash    TEXT UNIQUE   sha256(pepper ‖ normalized code) — the pepper is NOT in the database
secret_hash  TEXT          the 128-bit QR second factor, also hashed
prefix       VARCHAR(4)    "DR" — not a secret, used for support and routing
attempt_count / max_attempts
locked_at, expires_at, redeemed_at, redeemed_by, redeemed_at_location_id
```

No column holds anything from which the code can be recovered. `code_hash` is
`UNIQUE`, so lookup is a single indexed equality match and a collision is
impossible.

The peppered hash is the key design point: a stolen database dump is not a
cash-out opportunity, because the pepper lives in the secret store.

### `ledger_accounts` / `ledger_transactions` / `ledger_entries`

Classic double entry.

- `ledger_accounts` — typed (`ASSET`/`LIABILITY`/`REVENUE`/`EXPENSE`/`EQUITY`),
  single-currency, with `normal_balance` and an `is_custodial` flag marking funds
  held on behalf of customers or partners.
- `ledger_transactions` — one balanced posting. `posting_key` is **UNIQUE**, which
  is what makes a replayed webhook or a double-clicked button harmless.
  `reverses_id` links a correction to its original.
- `ledger_entries` — `amount_minor` is always positive; `direction` carries the
  sign.

**Balances are never stored.** They are `SUM(entries)`. A stored balance is a
cache that will eventually disagree with its source, and the disagreement will be
discovered during an audit.

**Every posting is single-currency.** Cross-currency movement is two linked
postings joined by FX position accounts — how a real treasury holds the exposure,
rather than pretending USD and DOP can balance against each other.

Two invariants, both tested:
- Within a posting, debits − credits = 0.
- Within a currency, across the whole ledger, debits = credits.

And one operational rule: **no custodial account may ever hold a negative
balance.** A negative `LIAB_CUSTOMER_FUNDS_USD` means the books claim we are
holding less than nothing on a customer's behalf. An earlier revision produced
exactly that on refunds; the regression test in
`tests/integration/transaction-lifecycle.test.ts` now guards it.

### `settlement_batches` / `settlement_lines`

What the platform owes each payout partner for cash they fronted.

The batch is `UNIQUE (institution_id, period_start, period_end)`, so regenerating
a period returns the existing batch instead of creating a second one.

`settlement_lines.pickup_event_id` is **`UNIQUE` across the whole table**, not
merely within a batch. That single constraint is what guarantees a disbursement
can never be settled twice, no matter how generation is invoked, how periods
overlap, or how many requests arrive concurrently. It is enforcement, not
validation — application logic cannot be relied on for a property this expensive
to get wrong.

`commission_bps` is snapshotted onto the batch so a later rate change cannot
restate a historical statement, exactly as `fee_schedules` versioning protects a
customer receipt.

> **Cleanup caveat.** `PickupEvent` is `onDelete: SetNull` on both its transaction
> and its agent, so deleting either leaves the event behind. That is correct for
> production — a payout record must outlive the rows around it — but it means test
> teardown has to remove pickup events explicitly, or orphans accumulate and
> pollute later settlement periods.

### `audit_logs` — append-only, redacted

`actor_id`, `actor_type`, `actor_roles[]`, `action`, `resource_type`,
`resource_id`, `before`, `after`, `metadata`, `ip_address`, `user_agent`,
`request_id`, `success`.

There is **no update or delete path** anywhere in the application. Every JSON
payload passes through `redact()` before write, stripping ~20 sensitive key names.

`success = false` rows matter most: a refused payout approval or a denied admin
call is exactly what a fraud investigation needs.

### `idempotency_keys`

`UNIQUE (scope, key)` — that constraint *is* the reservation mechanism; the
application merely interprets the violation. `request_hash` is a canonical hash
of the body, so a replay with different content is a `409` rather than a silent
second charge.

### `pickup_events` — the payout audit trail

Every verification attempt, success, failure, lock, approval, rejection, and
escalation, with agent, institution, location, address, document type, and last
four. `attempted_code_hash` is stored on failures so brute force is attributable
across codes.

---

## What is deliberately **not** stored

| Never stored | Instead |
| --- | --- |
| Card number, CVV, expiry, stripe data | Provider token, brand, BIN, last 4, issuing country |
| Full identity document number | Last 4 characters only |
| Plaintext pickup codes | `sha256(pepper ‖ code)` |
| Plaintext session tokens | `sha256(token)` |
| Plaintext passwords | `scrypt$N$r$p$salt$hash` |
| Plaintext TOTP secrets | AES-256-GCM ciphertext |
| Plaintext partner API secrets | AES-256-GCM ciphertext |
| Computed balances | Sum of ledger entries |

---

## Indexing

Indexes follow actual query paths rather than being sprinkled on every column:

| Query | Index |
| --- | --- |
| Customer's transaction list | `transactions (user_id, created_at)` |
| Compliance queue | `transactions (status, created_at)`, `(risk_level, status)` |
| Agent verifying a code | `pickup_codes (code_hash)` UNIQUE |
| Session resolution on every request | `sessions (token_hash)` UNIQUE |
| Location directory | `pickup_locations (country_code, city)` |
| Audit investigation | `audit_logs (resource_type, resource_id)`, `(actor_id, created_at)` |
| Brute-force detection | `pickup_events (agent_id, created_at)`, `(event_type, created_at)` |
| Webhook replay guard | `webhook_events (provider, external_id)` UNIQUE |

---

## Isolation and concurrency

Most reads run at `READ COMMITTED`. Operations where a concurrent duplicate would
be a financial loss run at **`SERIALIZABLE`** with a conditional update asserting
the expected prior state:

- **Pickup redemption** — `UPDATE pickup_codes SET status='REDEEMED' WHERE id=? AND status='ACTIVE'`.
  Zero rows updated means someone else won. PostgreSQL aborts the loser with a
  serialisation failure. Proven by an integration test firing three concurrent
  redemptions and asserting exactly one succeeds.
- **Payment capture** and its ledger postings, as one atomic unit.
- **Every state transition** — `UPDATE ... WHERE status = <expected>`.

The database is the arbiter, not application logic that could be raced.

---

## Migrations

```bash
npm run db:migrate        # create and apply (development)
npm run db:deploy         # apply only (production)
npm run db:seed           # demo data
```

Migrations are checked in under `prisma/migrations/`. Production applies with
`migrate deploy`, never `migrate dev`.

**Expand and contract** for anything destructive: add the new column, backfill,
switch reads, switch writes, then drop the old column in a later release. A
migration that drops a column holding financial history is not reversible by a
rollback.

---

## Retention

Not implemented — it is a legal question, not an engineering one.

Financial and audit records are typically subject to statutory retention periods
that **override** a customer's deletion request, and the applicable period must be
set by counsel. What the schema provides is the mechanism: `deleted_at` for soft
deletion on `users`, `transactions`, `pickup_institutions`, and
`pickup_locations`, so a record can be withdrawn from operational use while
remaining available for audit.

`rate_limit_counters` and `idempotency_keys` carry `expires_at` and have prune
functions; a scheduled job should run them. Both belong in Redis in production.

---

## Local operations

```bash
npm run db:up        # PostgreSQL 16 on :5433 via Docker
npm run db:migrate
npm run db:seed
npm run db:studio    # Prisma Studio
npm run db:reset     # DESTRUCTIVE — drops and recreates
```

The container maps host port **5433**, not 5432, to avoid colliding with a local
PostgreSQL install.
