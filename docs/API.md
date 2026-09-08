# Larimar — API Reference

Machine-readable specification: **`public/openapi.json`** (OpenAPI 3.1), generated
from the same Zod schemas the route handlers validate with:

```bash
npm run openapi
```

Documentation generated from the implementation cannot drift from it. A
hand-maintained spec would be wrong within a week.

---

## Conventions

### Money is always a string

```json
{ "payoutAmountMinor": "2000000", "payoutCurrency": "DOP" }
```

That is **RD$20,000.00** — an integer count of minor units, transmitted as a
**string**. JSON numbers are IEEE-754 doubles; a `bigint` amount would lose
precision silently, and this system promises exact payouts. Every monetary field
in every request and response follows this rule.

Exchange rates are decimal strings (`"59.7981"`). Internally they are integers
scaled by 10^8; the string is the presentation form.

### Errors have one shape

```json
{
  "error": {
    "code": "LIMIT_EXCEEDED_DAILY",
    "message": "This transaction cannot be completed at this time"
  }
}
```

Validation failures add a `fields` array:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please check the highlighted fields.",
    "fields": [{ "path": "payoutAmountMinor", "message": "Amount must be a whole number of minor units" }]
  }
}
```

`code` is stable and safe to branch on. `message` is written for a customer.
Server errors (5xx) always return a generic message — an internal detail, a
stack trace, or a database error never reaches a client.

### Unknown fields are rejected

Every schema is `.strict()`. Sending an unrecognised property returns `422`
rather than being silently ignored. This is what stops a client smuggling
`{"amount": 1, "status": "PICKED_UP"}` past a handler.

### Idempotency

Every mutating financial endpoint requires an `Idempotency-Key` header:

```http
POST /api/transactions
Idempotency-Key: 3f2b9c1e-7a44-4d2e-9f1a-6b0c2d8e5a13
Content-Type: application/json
```

| Situation | Result |
| --- | --- |
| Same key, same body | The stored original response, with `Idempotent-Replay: true` |
| Same key, different body | `409 IDEMPOTENCY_KEY_REUSED` |
| Same key, still in flight | `409 IDEMPOTENCY_IN_PROGRESS` with `Retry-After` |

Bodies are hashed canonically (keys sorted), so `{a,b}` and `{b,a}` are the same
request.

### Authentication

An opaque session token in an `HttpOnly; Secure; SameSite=Lax` cookie, stored
hashed server-side and revocable immediately. Not a JWT — a cash platform needs
instant revocation.

State-changing requests are additionally origin-checked.

### Rate limiting

Applied **after** authentication so per-user rules can bucket by user id.
Exceeding a limit returns `429` with `Retry-After`.

| Endpoint | Limit | Bucketed by |
| --- | --- | --- |
| `POST /api/auth/login` | 10 / 15 min | address |
| `POST /api/auth/register` | 5 / hour | address |
| `POST /api/exchange-rates` | 60 / min | address |
| `POST /api/transactions` | 20 / hour | user |
| `POST /api/pickup/verify` | 10 / min | user |
| `POST /api/kyc` | 5 / hour | user |

---

## What a client may never send

The API refuses, by design, to accept any of the following. All are computed
server-side from database rows:

- an exchange rate
- a fee of any kind
- a total charged
- a transaction status
- a risk score
- a payout amount at redemption that exceeds the outstanding balance
- a ledger entry

A client sends the amount it wants to receive, a country, a funding currency, and
a preferred location. That is the entire trusted surface.

---

## Endpoints

### Authentication

#### `POST /api/auth/register`

```json
{
  "email": "john@example.com",
  "password": "a-long-passphrase-here",
  "firstName": "John",
  "lastName": "Traveler",
  "acceptedTerms": true,
  "deviceFingerprint": "dev_abc123"
}
```

Returns `201 {"created": true, "userId": "...", "roles": ["CUSTOMER"]}` and sets
the session cookie.

**Responds identically when the address is already registered** (without a
`userId`), so this endpoint cannot be used to enumerate customers. The real owner
is notified by email that someone attempted to re-register their address.

#### `POST /api/auth/login`

```json
{ "email": "john@example.com", "password": "...", "totpCode": "123456" }
```

`totpCode` is required for staff roles. A wrong password and an unknown account
both return `401 INVALID_CREDENTIALS` — identical code, identical message,
identical timing (the server verifies a decoy hash when no user exists).

Eight failures locks the account for 15 minutes: `403 ACCOUNT_LOCKED`.

#### `POST /api/auth/logout`

Revokes the session server-side and clears the cookie.

#### `POST /api/auth/password-reset` · `PUT /api/auth/password-reset`

`POST` begins a reset and **always** reports success. `PUT` completes it with
`{token, password}` and **revokes every existing session** for that account.

#### `GET /api/me`

Profile, roles, KYC level, and remaining daily/monthly limits.

---

### Pricing

#### `GET /api/exchange-rates?base=USD&country=DO`

```json
{
  "base": "USD", "quote": "DOP",
  "midRate": "60.2500", "effectiveRate": "59.7981", "spreadBps": 75,
  "source": "mock-deterministic-demo",
  "isDemoRate": true
}
```

`isDemoRate` is `true` whenever the mock provider is installed. Clients must
surface it. Public — a traveler checks the price before creating an account.

#### `POST /api/exchange-rates`

```json
{ "payoutAmountMinor": "2000000", "payoutCurrency": "DOP", "fundingCurrency": "USD", "countryCode": "DO" }
```

```json
{
  "payoutAmountMinor": "2000000", "payoutCurrency": "DOP",
  "principalMinor": "33446",
  "platformFeeMinor": "502",
  "processingFeeMinor": "1014",
  "expeditedFeeMinor": "0",
  "totalChargedMinor": "34962",
  "fundingCurrency": "USD",
  "fxSpreadCostMinor": "250",
  "totalCostMinor": "1766",
  "midRate": "60.2500", "effectiveRate": "59.7981", "fxSpreadBps": 75,
  "expiresAt": "2026-09-08T12:15:00.000Z",
  "isDemoRate": true
}
```

Nothing is persisted — the public calculator cannot create rows. Note
`fxSpreadCostMinor`: the spread is disclosed as its own line rather than hidden
inside the rate.

---

### Transactions

#### `POST /api/transactions`

Requires `Idempotency-Key`.

```json
{
  "payoutAmountMinor": "2000000",
  "countryCode": "DO",
  "fundingCurrency": "USD",
  "pickupLocationId": "uuid",
  "deviceFingerprint": "dev_abc123"
}
```

```json
{
  "transactionId": "uuid",
  "reference": "LRM-7F3K2Q8M",
  "status": "KYC_REQUIRED",
  "riskLevel": "LOW",
  "kycRequired": true
}
```

The server prices it, scores it, checks limits, and decides the next status. The
numeric risk score is internal; only the bucket is returned.

Refusals carry a specific reason: `LIMIT_EXCEEDED_DAILY`,
`LIMIT_EXCEEDED_MONTHLY`, `LIMIT_EXCEEDED_VELOCITY`, `AMOUNT_BELOW_MINIMUM`,
`AMOUNT_ABOVE_MAXIMUM`, `SANCTIONS_MATCH`, `RISK_BLOCKED`.

#### `GET /api/transactions` · `GET /api/transactions/{id}`

List and detail. Ledger postings are included only for principals holding
`ledger.read`.

#### `POST /api/transactions/{id}/cancel`

Permitted only before funding.

---

### Payments

#### `POST /api/transactions/{id}/payment` — create an intent

Returns `{paymentId, providerRef, clientSecret, amountMinor, currency}`. The
client exchanges card details **directly with the provider** using the client
secret. Reuses an open intent rather than creating a second charge.

#### `PUT /api/transactions/{id}/payment` — confirm

```json
{ "paymentToken": "tok_demo_visa_debit_ok" }
```

> **The token must never be a card number.** The schema rejects anything matching
> `^\d{12,19}$` after stripping separators, and the mock provider throws on one.

```json
{
  "status": "READY_FOR_PICKUP",
  "reference": "LRM-7F3K2Q8M",
  "pickupCode": "DR-4829-7316",
  "pickupSecret": "9f2b...",
  "expiresAt": "2026-10-08T12:00:00.000Z"
}
```

**This is the only response, ever, that contains the plaintext pickup code.** It
is stored as a peppered hash and no endpoint returns it again.

Other outcomes: `PAYMENT_FAILED` (with `failureCode`, `failureMessage`),
`COMPLIANCE_REVIEW` (held for a human; no code issued yet), `REQUIRES_ACTION`
(3-D Secure, with `actionUrl`).

Demo scenario tokens: `tok_demo_visa_debit_ok`, `tok_demo_mc_credit_ok`,
`tok_demo_decline_insufficient_funds`, `tok_demo_decline_suspected_fraud`,
`tok_demo_decline_expired_card`, `tok_demo_requires_3ds`.

---

### Identity

#### `POST /api/kyc`

```json
{
  "firstName": "John", "lastName": "Traveler", "dateOfBirth": "1985-04-12",
  "documentType": "PASSPORT", "documentNumber": "X1234567",
  "documentCountry": "US", "residenceCountry": "US",
  "transactionId": "uuid"
}
```

The document number reaches the provider and is then **discarded** — only the
last four characters are persisted, and the audit record contains no more.

Demo triggers: surname `REJECT` fails, `REVIEW` routes to manual review,
`SANCTIONED` produces a screening hit.

---

### Pickup

#### `GET /api/pickup/locations?q=Punta+Cana`

Public. Every location carries `isDemo` and a `demoNotice` string that clients
**must** display:

```json
{ "isDemo": true, "demoNotice": "DEMO LOCATION — NOT A REAL PARTNER" }
```

#### `POST /api/pickup/verify` — permission `pickup.verify`

```json
{ "code": "DR-4829-7316", "secret": "9f2b...", "locationId": "uuid" }
```

Returns a deliberately narrow view:

```json
{
  "transaction": {
    "reference": "LRM-7F3K2Q8M",
    "status": "READY_FOR_PICKUP",
    "payoutAmountMinor": "2000000",
    "remainingMinor": "2000000",
    "payoutCurrency": "DOP",
    "acceptedDocuments": ["PASSPORT", "NATIONAL_ID", "DRIVERS_LICENSE"],
    "complianceCleared": true,
    "expiresAt": "2026-10-08T12:00:00.000Z",
    "isDemoLocation": true
  }
}
```

**No name, email, phone, address, card data, funding amount, or history.** The
agent needs the payout figure and the document requirement; nothing else.

Burns a verification attempt. Five failures lock the code and raise a fraud
alert. Attempts are also counted per agent and per address, catching an attacker
who spreads guesses across many codes to stay under the per-code cap.

#### `POST /api/pickup/redeem` — permission `pickup.redeem`

Requires `Idempotency-Key`.

```json
{
  "code": "DR-4829-7316",
  "locationId": "uuid",
  "amountMinor": "2000000",
  "documentType": "PASSPORT",
  "documentLast4": "4567",
  "identityConfirmed": true
}
```

Runs at `SERIALIZABLE` with a conditional update. Concurrent attempts produce
**exactly one** payout. `SUPPORT_AGENT` deliberately lacks this permission.

#### `POST /api/pickup/reject` · `POST /api/pickup/escalate`

Reject records a refusal without changing state. Escalate opens a compliance case
and moves the transaction to `COMPLIANCE_REVIEW`, blocking disbursement
everywhere — including other branches of the same institution.

---

### Compliance

#### `GET /api/compliance/review` — permission `compliance.case.read`

#### `POST /api/compliance/review`

```json
{ "transactionId": "uuid", "action": "RELEASE", "reason": "Verified with customer" }
```

`HOLD` requires `compliance.hold.place`. `RELEASE` and `REJECT` additionally
require `compliance.hold.release`, which `SYSTEM_ADMIN` deliberately does not
hold — the person who configures the platform does not clear its holds.

Releasing issues the pickup code if one was not issued at capture.

---

### Admin

`GET /api/admin/metrics` — aggregates, 30-day series, distributions, and the
ledger integrity flag.

`GET /api/admin/transactions?q=...&status=...&riskLevel=...` — searches
reference, email, id, **and pickup code**. A code is hashed with the same pepper
before matching, so support can find a transaction from a code read aloud without
the plaintext ever being stored.

---

### Webhooks

`POST /api/webhooks/payment` · `POST /api/webhooks/kyc`

```http
X-Larimar-Signature: <hmac-sha256 hex>
X-Larimar-Timestamp: <unix seconds>
```

The signature covers `{timestamp}.{raw body}`. Three guards: signature validity,
timestamp inside the tolerance window (300s), and uniqueness of the provider's
event id. Invalid attempts are recorded as `WebhookEvent` rows with status
`INVALID_SIGNATURE` — probing leaves a trail.

Returns `200` for duplicates so the provider stops retrying; `500` for genuine
processing failures so it retries.

---

### Partner API

See [`PARTNER_INTEGRATION.md`](./PARTNER_INTEGRATION.md).

`POST /api/partner/v1/pickup/verify` · `POST /api/partner/v1/pickup/redeem`

HMAC-SHA256 over `METHOD\nPATH\nTIMESTAMP\nSHA256(body)`. Binding the method and
path stops a signature captured from a read-only call being replayed against
redeem.

---

### Health

`GET /api/health` → `{"status": "ok", "demoMode": true, "timestamp": "..."}`

Reports database reachability and nothing else. Health endpoints are
unauthenticated and a common reconnaissance target.

---

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | Malformed or unknown fields |
| `UNAUTHENTICATED` | 401 | No valid session |
| `MFA_REQUIRED` | 401 | Second factor needed |
| `INVALID_CREDENTIALS` | 401 | Wrong credentials, or no such account |
| `ACCOUNT_LOCKED` | 403 | Too many failed attempts |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `KYC_REQUIRED` | 403 | Identity verification needed for this amount |
| `COMPLIANCE_HOLD` | 403 | Held; must not be disbursed |
| `SANCTIONS_MATCH` | 403 | Screening hit |
| `RISK_BLOCKED` | 403 | Risk score above the block threshold |
| `NOT_FOUND` / `TRANSACTION_NOT_FOUND` | 404 | |
| `CONFLICT` | 409 | State changed under the request |
| `ILLEGAL_STATE_TRANSITION` | 409 | Not a legal edge, or not for this actor |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key, different body |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Identical request already running |
| `PICKUP_CODE_ALREADY_REDEEMED` | 409 | |
| `QUOTE_EXPIRED` / `RATE_EXPIRED` / `PICKUP_CODE_EXPIRED` | 410 | |
| `AMOUNT_BELOW_MINIMUM` / `AMOUNT_ABOVE_MAXIMUM` | 422 | |
| `LIMIT_EXCEEDED_DAILY` / `LIMIT_EXCEEDED_MONTHLY` | 422 | |
| `LIMIT_EXCEEDED_VELOCITY` | 429 | |
| `PICKUP_CODE_ATTEMPTS_EXCEEDED` | 429 | |
| `RATE_LIMITED` | 429 | |
| `WEBHOOK_SIGNATURE_INVALID` / `WEBHOOK_REPLAY` | 400 | |
| `PROVIDER_ERROR` | 502 | Upstream provider failure |
| `RATE_UNAVAILABLE` | 503 | No rate for this corridor |
| `INTERNAL_ERROR` | 500 | Generic; details are logged, never returned |
