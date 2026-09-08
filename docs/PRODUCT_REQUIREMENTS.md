# Larimar — Product Requirements Document

**Document status:** v1.0 — foundation release
**Product stage:** Pre-licence technical prototype (DEMO MODE)

> ### Regulatory status of this document
> Larimar is **not** an authorised money transmitter, payment institution, remittance
> provider, or foreign-exchange dealer in the Dominican Republic or anywhere else.
> This document specifies a **technical foundation**. Every reference to moving customer
> funds describes behaviour that is **simulated** in the current build and that **cannot
> lawfully be operated for real money** until the licensing, banking, and partnership
> dependencies in [`LEGAL_AND_COMPLIANCE.md`](./LEGAL_AND_COMPLIANCE.md) are satisfied.

---

## 1. Brand

| Attribute | Value |
| --- | --- |
| Product name | **Larimar** |
| Legal-entity placeholder | Larimar Financial Technologies (placeholder — no entity formed) |
| Positioning | *Your digital cash bridge while traveling.* |
| Primary promise | *Get Dominican pesos without using your card at an ATM.* |

**Why "Larimar."** Larimar is a pale blue pectolite gemstone found in commercially viable
quantities in exactly one place on earth: the Bahoruco mountains of Barahona province,
Dominican Republic. It is unmistakably Dominican, it is pronounceable on first sight by an
English, Spanish, French, or German speaker (*la-ri-MAR*), it contains *mar* — the sea — and
it carries none of the semantic baggage of cryptocurrency naming. It reads as a bank,
an insurer, or an asset manager, which is precisely the register a cash-handling
platform needs.

**Logo concept.** Two nested arcs forming an **L** that also reads as a bridge span over
water, set in the Larimar palette, next to a geometric letter-spaced wordmark. The arcs
never close — the negative space is the "bridge" the brand promises. Implemented as a
live SVG React component in `src/components/brand/Logo.tsx`, not a static image, so it
scales cleanly and inherits theme colour.

Palette: Deep Navy `#0A1F33` (trust) · Larimar `#1C93B8` (identity) · Pale Larimar
`#CFE9F1` (surface) · Sand `#E8B24A` (accent, used sparingly for value emphasis).

---

## 2. Problem statement

A foreign traveler in the Dominican Republic who needs pesos today has three bad options:

1. **ATM withdrawal.** Compatibility is inconsistent between card networks and local
   acquirers. Fees stack: the local operator fee, the issuer's foreign-transaction fee,
   and a dynamic-currency-conversion markup accepted under time pressure at the keypad.
   The traveler's physical card enters an unfamiliar device.
2. **Merchant terminal.** Same card-present exposure, and the traveler still ends up
   without cash for the many DR contexts that are cash-first.
3. **Airport or hotel exchange counters.** Poor rates, disclosed only after arrival.

The recurring cost across all three is **repeated card-present exposure**: each additional
physical use of a foreign card at an unfamiliar terminal is another opportunity for
skimming, shoulder-surfing, or a disputed transaction far from home.

## 3. Value proposition

> **Get Dominican pesos without using your foreign card at an ATM.**

Larimar collapses many card-present events into **one card-not-present event** executed on
the traveler's own device, on a screen they control, at a price they see in full before
they authorise it. The output is a **pickup code** redeemed for cash at an authorised
payout location.

Supporting benefits:

- Predictable, itemised pricing shown **before** authorisation — no surprise DCC markup.
- Cash can be arranged **before** it is needed (from home, from the plane, from the hotel).
- A durable digital record of every transaction, usable for expense or dispute purposes.
- Reduced dependence on locating a compatible ATM.
- One funding event instead of N withdrawal events reduces aggregate exposure surface.

**Claims we will not make.** We will not claim Larimar is "safer than a bank," that it
eliminates fraud risk, that our rate beats any specific competitor, or that any named
institution is a partner. Marketing copy is constrained by
[`LEGAL_AND_COMPLIANCE.md`](./LEGAL_AND_COMPLIANCE.md).

---

## 4. Primary persona

**John — 41, New York, five nights in Punta Cana.**

Needs roughly RD$20,000 across the trip for taxis, beach vendors, tips, and a day trip.
His US debit card works at some local ATMs and is declined at others. He has already had a
card reissued once after a skimming incident abroad. He is not price-obsessed; he is
**friction- and risk-obsessed**. He will pay a transparent, stated fee to avoid an
unpredictable one and to keep his card in his pocket.

**What John's journey must feel like.** Land, open Larimar on his phone, type `20000`,
see exactly what his card will be charged in USD, pay, receive `DR-4829-7316`, walk
into an authorised location, show passport and code, walk out with RD$20,000.

Secondary personas: **Ana**, a payout-window agent at a participating institution who needs
a fast, unambiguous verify-and-pay screen in Spanish; **Marcos**, a compliance analyst who
needs to hold, review, and release transactions with a full audit trail.

---

## 5. Scope

### 5.1 In scope for this release (v0.1, DEMO MODE)

| # | Capability | Notes |
| --- | --- | --- |
| F-01 | Public site: landing, how it works, fees, security, locations, FAQ, trust and compliance, legal pages | Bilingual EN/ES |
| F-02 | Live quote calculator (unauthenticated) | Server-computed; never client-computed |
| F-03 | Registration, login, logout, password reset, session management | Scrypt hashing, rotating session tokens |
| F-04 | TOTP multi-factor authentication (enrol, verify, recovery codes) | RFC 6238, implemented on `node:crypto` |
| F-05 | Simulated identity verification (KYC) with provider abstraction | `MockKycProvider` |
| F-06 | Transaction creation with server-authoritative quote locking | Quote expiry and re-confirmation |
| F-07 | Simulated card payment with tokenisation boundary | `MockPaymentProvider`; no PAN ever reaches our systems |
| F-08 | Full 16-state transaction state machine, server-enforced | Illegal transitions rejected at the domain layer |
| F-09 | Cryptographically random, rate-limited, expiring, single-use pickup codes | 40 bits entropy, hashed at rest |
| F-10 | QR representation of the pickup credential | Contains no personal data |
| F-11 | Customer dashboard, transaction history and detail, receipt | |
| F-12 | Pickup location directory with search and filters | All demo locations clearly labelled |
| F-13 | Agent portal: verify code, confirm identity, approve/reject/escalate payout | Location-scoped authorisation |
| F-14 | Admin console: metrics, charts, transaction search, compliance queue, KYC queue, pricing configuration, locations, audit log | |
| F-15 | Double-entry ledger with enforced balance invariant | Every financial event posts balanced entries |
| F-16 | Risk engine: limits, velocity, geography, device, scoring, auto-escalation | Configurable, not hardcoded |
| F-17 | Notification architecture with mock email/SMS/WhatsApp/push transports | Outbox pattern |
| F-18 | Partner REST API with HMAC request signing | For future payout institutions |
| F-19 | OpenAPI 3.1 specification | Generated from the same Zod schemas the API validates with |
| F-20 | Country configuration layer | DR implemented; MX/CO/CR/PA/JM/PR scaffolded |
| F-21 | Internationalisation, EN default plus full ES | No hardcoded user-facing strings |

### 5.2 Explicitly out of scope for v0.1

Real money movement · real card processing · real KYC vendor · real bank integration ·
native mobile apps · Apple Pay and Google Pay · ACH · settlement file generation ·
production-grade key management (HSM/KMS) · SOC 2 or PCI DSS attestation.

---

## 6. Core user flows

### 6.1 Quote to cash (the flow that must be flawless)

```
Landing -> Enter DOP amount -> Live quote (server-priced)
        -> Register / log in
        -> Identity verification (if required by limits or risk)
        -> Review: YOU RECEIVE RD$20,000 | YOU PAY $XXX.XX | fees itemised | rate shown
        -> Choose pickup location
        -> Confirm and pay -> [payment provider, tokenised]
        -> Compliance evaluation (automatic; manual only when risk demands)
        -> READY_FOR_PICKUP + pickup code + QR
        -> Present code and government ID at authorised location
        -> Agent verifies -> pays cash -> PICKED_UP
```

**Non-negotiable pricing rule.** The customer sees, before authorising: the exact DOP they
will receive, the exact charge in funding currency, the exchange rate used, the platform
fee, and the payment-processing fee — as separate line items. If the underlying rate moves
beyond tolerance before authorisation, the quote is invalidated and the customer must
confirm a fresh one. Fees are never bundled or hidden inside the rate without disclosure of
the spread.

### 6.2 Payout at the window

Agent authenticates, enters or scans the code, and the system returns **only**: status,
amount and currency to pay, the identity-document requirements, creation and expiry
timestamps, and a compliance flag. The agent does **not** see the customer's email,
address, card data, funding amount, or transaction history. The agent confirms identity,
approves, and the backend records employee, institution, location, timestamp, amount, and
verification result as an immutable audit event. State becomes `PICKED_UP` and the ledger
posts the payout and settlement-liability entries.

---

## 7. Functional requirements (selected, testable)

| ID | Requirement | Verification |
| --- | --- | --- |
| FR-1 | All monetary values are stored and computed as integer minor units. No floating-point arithmetic anywhere in financial logic. | Unit tests; code review |
| FR-2 | Quotes are computed server-side. A client-supplied amount, rate, fee, or total is never trusted. | Integration tests assert tampered input is rejected |
| FR-3 | Transaction state changes only via the domain state machine. Illegal transitions raise and are logged. | Unit tests enumerate the full legal transition matrix |
| FR-4 | Pickup codes carry at least 40 bits of CSPRNG entropy and are stored only as a peppered hash. | Unit tests; schema review |
| FR-5 | A pickup code may be successfully redeemed at most once. Concurrent redemption attempts must produce exactly one payout. | Integration test with concurrent redemption |
| FR-6 | Verification attempts against a code are limited; exceeding the limit locks the code and raises a fraud alert. | Unit and integration tests |
| FR-7 | Every state-changing financial operation accepts an idempotency key and is safe to retry. | Integration tests replay identical requests |
| FR-8 | Every ledger transaction sums to zero across its entries. Unbalanced postings are rejected. | Unit test and runtime guard |
| FR-9 | A customer cannot reach any agent, compliance, or admin endpoint. | RBAC test matrix over every route |
| FR-10 | An agent can only act on transactions assigned to their authorised location. | Authorisation tests |
| FR-11 | A support agent cannot approve a payout. A compliance analyst can place a hold. | RBAC test matrix |
| FR-12 | Every privileged action writes an append-only audit record with actor, subject, IP, and user agent. | Integration tests |
| FR-13 | Webhooks are rejected unless the HMAC signature and timestamp both verify. | Unit and integration tests |
| FR-14 | No user-facing string is hardcoded in a component. | Review; translation-parity test |
| FR-15 | Transactions exceeding configured daily or monthly limits are refused; high risk scores route to `COMPLIANCE_REVIEW` automatically. | Unit and integration tests |

---

## 8. Non-functional requirements

- **Mobile-first.** The primary device is a phone on hotel Wi-Fi or roaming data. Every
  flow must be complete and comfortable at 375 px wide. Tap targets at least 44 px.
- **Latency.** Quote calculation p95 under 300 ms server-side. Pickup-code verification
  p95 under 500 ms — an agent and a customer are both standing at a window waiting.
- **Availability target (future, licensed phase).** 99.9% for the payout-verification path;
  it is the path where failure is most visible and most damaging.
- **Accessibility.** WCAG 2.2 AA: contrast, focus visibility, keyboard operability,
  semantic landmarks, form labelling, reduced-motion support.
- **Bilingual.** EN default, full ES parity. Locale is user-selectable and persisted.
- **Auditability.** Any money-affecting action must be reconstructable from the audit log
  and the ledger without reference to application logs.

---

## 9. Business model

Four configurable revenue mechanisms, all administrable and none hardcoded as commercial
rates:

| Mechanism | Demo default | Notes |
| --- | --- | --- |
| Platform fee | 1.50% of principal, minimum $2.99 | Percentage plus fixed floor |
| FX spread | 0.75% off mid-market | **Disclosed** to the customer as a separate line |
| Payment processing | 2.90% + $0.30 | Provider-dependent pass-through |
| Expedited pickup | $4.99 flat, optional | Fee engine supports it; not surfaced in v0.1 UI |

These are **placeholders for engineering purposes**. Real pricing requires unit-economics
work against actual processor costs, FX funding costs, payout-partner commissions,
chargeback provisioning, and any applicable Dominican consumer-pricing disclosure rules.

The FX spread is disclosed rather than buried. That is a deliberate product decision: the
entire value proposition is *predictability*, and a hidden spread is the exact behaviour
travelers resent about airport counters and DCC prompts.

---

## 10. Success metrics (post-licence)

Activation: quote-to-funded conversion. Reliability: **payout success rate** — the
percentage of `READY_FOR_PICKUP` transactions redeemed before expiry — is the metric that
determines whether the product is real. Trust: repeat rate within a single trip. Risk:
chargeback rate in basis points, fraud loss per RD$ paid out, and false-positive rate on
compliance holds (a customer wrongly held at a payout window is a catastrophic experience).

---

## 11. Key product risks

| Risk | Impact | Mitigation posture |
| --- | --- | --- |
| Licensing not obtained | Fatal | Nothing ships to real money before counsel sign-off; the codebase is deliberately provider-agnostic so a licensed-partner model can be adopted without a rewrite |
| No payout network | Fatal | Partner API and institution onboarding modelled from day one |
| Card fraud and chargeback exposure on a cash-out product | Severe — cash-out is a classic fraud target | Layered: KYC before payout, risk scoring, velocity limits, code entropy and attempt limits, delay windows, single-use redemption, full audit |
| Customer arrives and cannot be paid (float or liquidity) | Severe trust damage | Location capacity modelled in the schema from v0.1; real deployment needs live float telemetry |
| FX exposure between funding and payout | Financial | Quote expiry and re-confirmation; a hedging strategy is required pre-launch |

---

## 12. Build order followed

1. Inspect repository (empty). 2. This document. 3. `ARCHITECTURE.md`.
4. Database design. 5. Transaction state machine. 6. API contracts.
7. Provider interfaces. 8. Implementation. 9. Lint, typecheck, unit, integration, E2E.
10. Verified end-to-end demo transaction.
