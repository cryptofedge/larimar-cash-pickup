# Larimar — Fraud and Risk

---

## The asymmetry that defines this product

**The payout is irreversible. The funding is not.**

A card is charged. Pesos are counted out and handed to a person who walks out of
the building. Weeks later the cardholder disputes the transaction. The card
network claws the money back. The cash is gone.

Every control in this document exists because of that sentence. It is also why
the state machine models `PICKED_UP → DISPUTED` as a legal transition and why a
post-disbursement chargeback books straight to `EXP_FRAUD_LOSS_USD` — the ledger
states the loss plainly rather than burying it.

**Unit economics only work if the chargeback rate stays very low.** A platform
fee in the low single-digit percent cannot absorb a chargeback rate measured in
whole percent. That is the number to watch above all others.

---

## Attack catalogue

### A1 — Stolen card cash-out *(the primary threat)*

Fund a transaction with a stolen card, collect cash, disappear. The chargeback
arrives later and is unrecoverable.

| Control | Where |
| --- | --- |
| Identity verification above a configurable amount, **before** any payout | `risk.kycRequired`, enforced server-side at creation |
| Risk scoring on account age, device, geography, velocity, history | `evaluateRisk()` |
| Automatic hold above the review threshold | `COMPLIANCE_REVIEW` on capture |
| Per-transaction, daily, and monthly caps | `RiskPolicy`, database-configurable |
| Card BIN and issuing country retained for scoring | `payments.card_bin`, `card_country` |
| Chargeback history weighted heavily (40 points) | `history.chargebacks` rule |
| Card-testing detection | `history.failedPayments` — 3+ recent declines |

**Not yet implemented, and needed:** a mandatory delay between funding and
collection eligibility. It is the single most effective control against this
attack — most stolen-card fraud is time-sensitive — and it is a product decision
(it directly degrades the "arrange cash before you need it" promise) rather than
an engineering one.

### A2 — Pickup code theft

A code is a bearer credential. Shoulder-surfed, screenshotted, intercepted in a
forwarded message, or read off an unlocked phone.

| Control | Detail |
| --- | --- |
| Three factors | Typed code (40 bits) + QR secret (128 bits) + government ID |
| Identity check at the window | A code alone never releases cash |
| Never re-retrievable | Shown once, at payment confirmation; no endpoint returns it again |
| Hashed at rest with an out-of-database pepper | A dump is not a cash-out |
| Expiry | 30 days, configurable per country |
| Single use | Conditional update at `SERIALIZABLE` |

### A3 — Code guessing

| Control | Detail |
| --- | --- |
| Keyspace | 32^8 = 1,099,511,627,776 |
| Per-code attempts | 5, then locked plus a `CODE_BRUTE_FORCE` alert |
| **Cross-code detection** | `detectCodeBruteForce()` counts failures per *agent* and per *address*, not only per code |
| Endpoint rate limit | 10 verifications per minute |
| Indistinguishable failures | An unknown code and a wrong code return the same error |

The cross-code control is the one that matters. An attacker spreads guesses
across many codes precisely to stay under any per-code cap; counting per-code
alone would never fire.

### A4 — Dishonest agent

The insider threat. An agent marks a payout complete without handing over cash,
pays an accomplice, or colludes on a fraudulent transaction.

| Control | Detail |
| --- | --- |
| Location scoping | An agent acts only at assigned locations, checked before a code is even looked up |
| Immutable event trail | Every verification, approval, rejection, and escalation with agent, location, address, document type |
| Explicit identity assertion | `identityConfirmed: true` is required and recorded |
| Per-agent anomaly detection | Failure patterns aggregated per agent |
| Separation from compliance | An agent can escalate and stop a payout; only a compliance analyst can restart one |
| MFA mandatory | Every staff role |

**Not yet implemented:** dual control above a threshold (two agents for large
payouts), agent-level payout volume anomaly alerting, and mandatory rotation.

### A5 — Account takeover

| Control | Detail |
| --- | --- |
| Scrypt password hashing | N=2^15, ~32 MB per hash |
| Lockout | 8 failures → 15 minutes, plus a security notification |
| Session revocation | Immediate and server-side; password reset revokes **all** sessions |
| Device tracking | New-device signal feeds the risk score |
| Notifications | Sent on security-relevant events |
| No enumeration | Registration, login, and reset all refuse to reveal whether an account exists |

### A6 — Mule networks

Many accounts, one operator, funds consolidated and collected.

| Control | Detail |
| --- | --- |
| Device sharing | 30 points when a fingerprint is linked to 3+ accounts |
| Velocity | Count and value over rolling windows |
| Location risk tiering | Per-location `risk_tier` feeds the score |
| Geographic rules | Elevated-risk jurisdictions weighted |

**Weak here.** Device fingerprinting is a spoofable placeholder, and there is no
graph analysis linking accounts by payment instrument, address, or collection
pattern. A real programme needs both.

### A7 — Duplicate and replay

| Vector | Control |
| --- | --- |
| Double-tapped "Confirm & Pay" | `Idempotency-Key` on every mutating financial endpoint |
| Retried webhook | Unique provider event id, plus signature and timestamp window |
| Replayed partner signature | Method and path bound into the signed string |
| Concurrent redemption | `SERIALIZABLE` + conditional update |
| Double ledger posting | `posting_key` UNIQUE |

### A8 — Sanctions and prohibited parties

Screening at verification against sanctions and PEP lists. A hit blocks
absolutely — it is evaluated before the score and cannot be outweighed by good
behaviour — and opens a `CRITICAL` compliance case flagged for reporting.

**In this build screening matches four fixture strings.** It is a wiring test, not
screening.

---

## The scoring model

`evaluateRisk()` separates two distinct concepts, deliberately:

**Hard limits** are absolute refusals evaluated independently of the score:
sanctions hit, amount bounds, daily cap, monthly cap, velocity cap. A transaction
can be refused with a `LOW` behavioural score purely because it exceeds a cap —
and the customer gets an honest, specific reason rather than a vague "flagged as
risky."

**Weighted signals** aggregate to 0–100:

| Rule | Weight | Level |
| --- | --- | --- |
| `sanctions.hit` | 100 | CRITICAL |
| `device.blocked` | 100 | CRITICAL |
| `history.chargebacks` | 40 | HIGH |
| `sanctions.pep` | 35 | HIGH |
| `device.shared` (3+ accounts) | 30 | HIGH |
| `geo.highRiskCountry` | 30 | HIGH |
| `kyc.missingForAmount` | 25 | HIGH |
| `account.new` (< 1 hour) | 20 | MEDIUM |
| `velocity.approaching` | 20 | MEDIUM |
| `limits.dailyUtilisation` (≥ 80%) | 15 | MEDIUM |
| `history.failedPayments` (3+) | 15 | MEDIUM |
| `geo.ipCardMismatch` | 12 | MEDIUM |
| `account.young` (< 24 hours) | 10 | LOW |
| `account.emailUnverified` | 10 | LOW |
| `location.riskTier` (≥ 2) | 10 | MEDIUM |
| `device.new` | 8 | LOW |

Buckets: `LOW` < 30 · `MEDIUM` 30–59 · `HIGH` 60–84 · `CRITICAL` ≥ 85.
Decisions: ≥ `reviewScoreThreshold` (60) → hold for review; ≥
`blockScoreThreshold` (85) → refuse.

**Why the IP/card mismatch weight is deliberately low (12).** The entire customer
base is travelers. A US card used from a Dominican IP is the *expected* pattern,
not an anomaly. Weighting it like a normal e-commerce merchant would flag
essentially every legitimate customer — a false-positive rate that would make the
product unusable and would train analysts to click through holds without reading
them.

Every weight and threshold is a database row, versioned and editable by
`SYSTEM_ADMIN`, and every triggered signal is persisted as a `RiskEvent` so a
past decision can be explained.

---

## Demo limits are not legal limits

Shipped defaults: **$1,000/day**, **$5,000/month**, $10 minimum, $1,000 per
transaction, KYC above $250, 5 transactions per 24 hours.

These are **arbitrary engineering defaults chosen to make the demo exercise its
own limit logic.** They are not Dominican legal thresholds and must never be
represented as such. That statement appears in the code, the seed output, the
fees page, the AML disclosure page, and the FAQ.

---

## Response

| Alert | Auto-action | Human action |
| --- | --- | --- |
| `CODE_BRUTE_FORCE` | Lock the code | Investigate the agent and address |
| `CHARGEBACK_PATTERN` | `CRITICAL` if cash was disbursed | Review the account; consider suspension |
| `VELOCITY_BREACH` | Refuse the transaction | Review the pattern |
| `DEVICE_SHARING` | Weight the score | Investigate for a mule network |
| `SANCTIONS_HIT` | Block and open a case | Compliance review; assess reportability |
| `AGENT_ANOMALY` | Alert | Investigate the agent |

A compliance analyst can place a hold (blocking disbursement everywhere,
including other branches of the same institution), release it, or reject and
refund. Every decision is audited with the analyst's identity.

---

## Metrics to watch after launch

1. **Chargeback rate in basis points** — the number the business model depends on.
2. **Fraud loss per RD$ disbursed** — read directly from `EXP_FRAUD_LOSS_USD`.
3. **False-positive rate on holds** — a customer wrongly held *at a payout window*
   is a catastrophic experience. Optimising only for fraud loss makes this worse.
4. **Payout success rate** — `READY_FOR_PICKUP` transactions redeemed before
   expiry. If this is low, something in the network is failing.
5. **Verification failure rate per agent** — the earliest signal of insider fraud.
6. **Time from funding to collection** — a distribution shift is a signal.

---

## Gaps, ranked

1. **No delay window between funding and collection.** The single highest-value
   missing control against stolen-card cash-out.
2. **Device fingerprinting is a spoofable placeholder.** Needs a real
   device-intelligence vendor.
3. **Sanctions screening matches four strings.** Needs OFAC, UN, EU, UK HMT, and
   local lists with fuzzy matching, aliases, and transliteration.
4. **No graph analysis** linking accounts by instrument, device, address, or
   collection pattern.
5. **No machine-learning scoring.** The rules are hand-weighted; there is no
   feedback loop from confirmed fraud.
6. **No dual control** on large payouts.
7. **No 3-D Secure enforcement policy.** The mock supports the challenge flow, but
   when to *require* it is unset.
8. **No cross-institution intelligence sharing.**
9. **No alerting on the audit stream.** Alerts are written and not watched.
