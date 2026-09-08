# Larimar — Partner Integration Guide

**Audience:** banks, exchange houses, and payout networks evaluating an
integration.

> **No partner relationship exists.** Every institution and location in this
> software is fictional, created for demonstration and flagged `isDemo: true` in
> the database and in every API response. This document describes how an
> integration *would* work. Before it could, the licensing, banking, and
> compliance dependencies in [`LEGAL_AND_COMPLIANCE.md`](./LEGAL_AND_COMPLIANCE.md)
> must be resolved.

---

## What a partner does

Your windows hand Dominican pesos to a customer who presents a code and
identification. Larimar handles the customer relationship, the funding, the
compliance decision, and the settlement obligation to you.

```
Customer presents  DR-4829-7316  +  passport
        │
        ├─ 1. VERIFY   → amount, currency, ID requirements, compliance flag
        │
        ├─ 2. Your operator checks the physical document
        │
        └─ 3. REDEEM   → cash handed over; we owe you the settlement
```

Two endpoints. That is the whole integration surface.

---

## What you receive, and what you do not

**You receive:** the transaction reference, the exact amount and currency to pay,
which identity documents are acceptable, the creation and expiry timestamps, and
a compliance flag.

**You do not receive:** the customer's name, email address, phone number, postal
address, card details, the amount they were charged, or any transaction history.

This is deliberate. You need to know how much to hand over and what document to
check. Identity matching happens against the physical document, not against data
on a screen — which also means a compromise of your systems does not expose our
customers' personal data.

---

## Authentication

HMAC-SHA256 request signing. You hold a key id (public) and a secret. We store
your secret encrypted with AES-256-GCM and never in plaintext.

### The signed string

```
METHOD \n PATH \n TIMESTAMP \n SHA256_HEX(body)
```

For example:

```
POST
/api/partner/v1/pickup/verify
1757320800
a3f1...c9
```

Binding the **method and path** is not incidental: it stops a signature captured
from a read-only `verify` call being replayed against `redeem`. Hashing the body
stops content substitution.

### Headers

```http
X-Larimar-Key-Id: pk_live_...
X-Larimar-Timestamp: 1757320800
X-Larimar-Signature: <hex hmac-sha256>
Content-Type: application/json
```

Requests outside a 300-second timestamp window are rejected as replays. Keep your
clocks in NTP sync.

### Reference implementation

```js
import { createHash, createHmac } from 'node:crypto';

function sign({ method, path, body, keyId, secret }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const canonical = [method.toUpperCase(), path, timestamp, bodyHash].join('\n');
  const signature = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');

  return {
    'X-Larimar-Key-Id': keyId,
    'X-Larimar-Timestamp': timestamp,
    'X-Larimar-Signature': signature,
    'Content-Type': 'application/json',
  };
}
```

An unknown key id returns the same error as a bad signature, so key ids cannot be
enumerated.

---

## Endpoints

### `POST /api/partner/v1/pickup/verify`

```json
{
  "code": "DR-4829-7316",
  "locationId": "8f14e45f-ceea-467a-9f2b-1c3d4e5f6a7b",
  "operatorRef": "teller-42"
}
```

**200**

```json
{
  "transactionRef": "LRM-7F3K2Q8M",
  "status": "READY_FOR_PICKUP",
  "payout": { "amountMinor": "2000000", "currency": "DOP" },
  "identityRequirements": {
    "acceptedDocuments": ["PASSPORT", "NATIONAL_ID", "DRIVERS_LICENSE"]
  },
  "createdAt": "2026-09-08T12:00:00.000Z",
  "expiresAt": "2026-10-08T12:00:00.000Z",
  "compliance": { "cleared": true, "note": null },
  "isDemo": true
}
```

`amountMinor` is a **string** of integer minor units — `"2000000"` is
RD$20,000.00. See [`API.md`](./API.md#money-is-always-a-string).

> **If `compliance.cleared` is `false`, do not disburse.** Ask the customer to
> contact support. The redeem endpoint will refuse anyway, but the operator
> should not count out cash they will then have to take back.

**Verification burns an attempt.** Five failures lock the code permanently and
raise a fraud alert on our side. Do not build a retry loop.

Errors: `PICKUP_CODE_INVALID`, `PICKUP_CODE_EXPIRED`, `PICKUP_CODE_LOCKED`,
`PICKUP_CODE_ALREADY_REDEEMED`, `PICKUP_NOT_READY`, `FORBIDDEN` (the location is
not yours).

### `POST /api/partner/v1/pickup/redeem`

```json
{
  "code": "DR-4829-7316",
  "locationId": "8f14e45f-ceea-467a-9f2b-1c3d4e5f6a7b",
  "amountMinor": "2000000",
  "documentType": "PASSPORT",
  "documentLast4": "4567",
  "operatorRef": "teller-42",
  "idempotencyKey": "your-unique-key-per-payout",
  "identityVerified": true
}
```

`identityVerified` must be literally `true`. It is your operator's attestation
that they inspected the document, and it is recorded against your institution and
operator reference.

Send only the **last four characters** of the document number. Do not send the
full number; we do not want it and will not store it.

**200**

```json
{
  "transactionRef": "LRM-7F3K2Q8M",
  "paidMinor": "2000000",
  "remainingMinor": "0",
  "status": "PICKED_UP",
  "settlement": { "payableMinor": "2000000", "currency": "DOP" }
}
```

`settlement.payableMinor` is what we now owe you for fronting the cash.

**Single redemption is enforced by the database**, not by application logic: the
call runs at `SERIALIZABLE` isolation with a conditional update. If two of your
windows call simultaneously, exactly one succeeds and the other receives
`PICKUP_CODE_ALREADY_REDEEMED`. Retry safely with the same `idempotencyKey`.

---

## Integration requirements

### Operational

1. **Idempotency keys.** One per payout attempt, stable across retries. This is
   what makes a timeout safe.
2. **Never retry a rejection.** `PICKUP_CODE_INVALID` and `PICKUP_CODE_LOCKED` are
   final. Retrying burns attempts and raises fraud alerts against your institution.
3. **Clock sync.** NTP. A drifted clock fails every request.
4. **Verify before you count.** Call verify, check `compliance.cleared`, inspect
   the document, then redeem.
5. **Do not cache verify responses.** State changes; a hold can be placed between
   your verify and your redeem.

### Security

1. **Store the secret in a secret manager**, never in source, config files, or
   environment files committed anywhere.
2. **TLS 1.2+** on every call.
3. **Rotate secrets** on a schedule and immediately on any suspected compromise.
4. **Log the transaction reference and your operator reference**, never the pickup
   code.
5. **Restrict egress** to our API hostnames.

### Compliance

Your own AML obligations apply to cash you disburse. We provide the transaction
record and the audit trail; we do not and cannot discharge your obligations.
Identity verification at the window is **your** control, performed by **your**
staff, and recorded as your attestation.

---

## Settlement

### How it works

Batches are generated per institution per settlement period (whole UTC days by
default), covering the disbursements your windows made in that window.

```
DRAFT ──▶ ISSUED ──▶ RECONCILED ──▶ PAID
             │            ▲
             └──▶ DISPUTED ┘
```

The lifecycle is deliberately explicit. "We think we owe you this", "you agree we
owe you this", and "we have actually paid you" are three different facts, and
collapsing them into one flag is how settlement disputes become unresolvable.

**`PAID` is reachable only from `RECONCILED`.** Funds never leave before both
sides agree the figure.

### The figures

| Line | Meaning |
| --- | --- |
| `grossPayoutMinor` | Cash your windows actually handed over in the period |
| `commissionBps` / `commissionMinor` | Your commission, at the rate snapshotted when the batch was generated |
| `netPayableMinor` | gross + commission — what is transferred |

Commission is calculated on the **aggregate**, not per payout. Rounding each line
and summing would drift from the contractual figure by up to half a minor unit
per payout — invisible at ten transactions, a real argument at ten thousand.

The rate is snapshotted onto the batch, so a later rate change cannot restate a
historical statement.

### Reconciliation

You report your own total; we compare it to ours exactly.

**There is no tolerance band.** A one-centavo discrepancy on a cash settlement
usually means a payout is missing from one side's records, and burying it under a
threshold means discovering it much later against a much larger number. A
variance moves the batch to `DISPUTED` unless our analyst records an explicit
written reason for accepting it.

### A payout is settled exactly once

Guaranteed by a `UNIQUE` constraint on the settlement line's pickup-event id —
not by application logic. Re-running generation, overlapping period windows, or a
concurrent request cannot produce a second line for the same disbursement.

Settlement periods are half-open `[start, end)`, so a payout at exactly midnight
belongs to one period and never to both.

### Retrieving your statements

```http
GET /api/partner/v1/settlements
```

Scoped to your institution by the verified signature, never by a request field.
`DRAFT` batches are excluded — an internal working figure is not a statement.

A CSV statement is also available to our finance team and can be sent to you.
Every amount in it is an integer minor-unit string, because a spreadsheet
silently reformatting `20000.00` as a float is exactly the class of error this
system avoids everywhere else.

### Still to agree, commercially

| Item | Question |
| --- | --- |
| Cadence | Daily is implemented. Real time? Weekly? |
| Direction | Do you pre-fund, or do we? |
| Float | How much DOP at each window, and who bears the carry? |
| Reserve | Do we hold one against your exposure, or you against ours? |
| Failed payouts | Reversal path when cash is not actually handed over |
| Cut-off times | Which side of the settlement day a late payout falls on |
| Payment rail | **Nothing is implemented here.** Marking a batch paid records the intent and posts the ledger entry; there is no transfer behind it. |

---

## Onboarding

1. **Compliance review, both directions.** Your team assesses us; ours assesses
   you. This precedes any commercial discussion.
2. **Commercial agreement** covering everything in the settlement table.
3. **Institution record** created with `isDemo: false` — the flag that removes the
   "DEMO LOCATION — NOT A REAL PARTNER" banner. It is flipped only when a signed
   agreement exists.
4. **Location onboarding:** address, coordinates, opening hours, maximum payout,
   daily capacity, supported currencies, contact.
5. **API credentials** issued; secret delivered out of band.
6. **Sandbox integration** against the mock providers.
7. **Operator training** on the verify → inspect → redeem sequence, and on what to
   do when compliance is not cleared.
8. **Pilot** at one location with a low cap.
9. **Production**, contingent on every licensing dependency being satisfied.

---

## Support

For a real deployment this section would carry an integration support address, an
on-call escalation path with response-time commitments, a status page, and a
sandbox environment. None exist today — this is a demonstration.
