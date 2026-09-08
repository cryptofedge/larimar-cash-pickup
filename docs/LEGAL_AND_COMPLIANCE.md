# Larimar — Legal and Compliance Dependencies

**Status:** Pre-licence technical prototype
**Audience:** founders, counsel, prospective banking and payout partners

---

## 0. Read this first

> ### Larimar is not authorised to do any of the things it demonstrates.
>
> It is **not** a money transmitter, payment institution, remittance provider,
> foreign-exchange dealer, or financial intermediary in the Dominican Republic or
> in any other jurisdiction. It holds no licence, no registration, and no
> authorisation from any regulator.
>
> It has **no agreement, relationship, or arrangement** with any bank, exchange
> house, remittance company, or payout network. Every institution and location in
> this software is **fictional**, invented for demonstration, and labelled as
> such in the database, the API, and the user interface.
>
> It moves **no real money**. Every payment, exchange rate, identity check, and
> sanctions screen is simulated.
>
> **This document is not legal advice.** It is an engineering-side inventory of
> the areas that require professional review. It does not assert that any
> specific obligation applies, nor that the list is complete. Only qualified
> counsel admitted in the relevant jurisdiction can answer these questions.

---

## 1. Why this document exists

It is easy to build software that looks like a financial service and much harder
to lawfully operate one. This project was built deliberately so that the
technical work is not the thing standing between the concept and a live product —
the licensing, banking, and partnership work is. That work is enumerated here so
it can be scoped and priced, rather than discovered late.

The single most important structural decision follows from it: **the codebase is
provider-agnostic.** No payment processor, KYC vendor, rate source, or payout
network is assumed. If counsel concludes the viable route is to operate as the
technology layer for an already-licensed institution rather than as a licensed
entity, that is an implementation change behind existing interfaces, not a
rewrite.

---

## 2. Dominican Republic — areas requiring review

Descriptive only. Each item names a topic counsel must assess; none asserts an
obligation.

### 2.1 Monetary and financial law

The Dominican monetary and financial framework (commonly cited as Ley Monetaria y
Financiera No. 183-02) and the regulations issued under it govern who may
intermediate funds and conduct exchange operations. Counsel must determine
whether this model constitutes a regulated activity, and if so which.

### 2.2 Central bank and supervisory authorisation

The Junta Monetaria and the Banco Central de la República Dominicana set policy
and authorisations in this space; the Superintendencia de Bancos supervises
institutions within its perimeter. Whether Larimar's model falls inside that
perimeter, and under what category, is the threshold legal question.

### 2.3 Foreign exchange

Converting USD to DOP for the public may constitute a regulated exchange
operation requiring separate authorisation as an exchange agent or equivalent.
Reporting obligations for FX volumes may also apply.

### 2.4 Remittance and money transmission

The service resembles a remittance in mechanics (funds in one country, cash out
in another) while differing in that sender and recipient are the same person.
Whether that distinction matters legally is a question for counsel, not
engineering.

### 2.5 AML / CFT

Anti-money-laundering and counter-terrorist-financing obligations (commonly cited
as Ley No. 155-17 and its implementing regulations) typically require a written
programme, a designated compliance officer, customer due diligence, transaction
monitoring, record retention, sanctions screening, and reporting channels for
suspicious operations. The platform implements the *technical* controls; it does
not and cannot supply the legal programme, the officer, or the reporting
relationship.

### 2.6 Consumer protection and disclosure

Pro-Consumidor and any sector-specific rules may prescribe how fees, exchange
rates, and total costs must be disclosed, in what language, and at what point in
the flow. The current design discloses every component before authorisation,
which is a good starting posture, but the specific required form is a legal
question.

### 2.7 Data protection

Dominican data-protection law (commonly cited as Ley No. 172-13) governs
collection and processing of personal data. Cross-border transfer rules matter
because customers are foreign nationals whose data may originate in the EU
(GDPR), the UK, California (CCPA/CPRA), or elsewhere — potentially several
regimes at once for a single customer.

### 2.8 Tax

Corporate income tax, ITBIS treatment of fees, withholding, transfer pricing if
structured across entities, and information-reporting obligations.

---

## 3. Card network and payment obligations

### 3.1 PCI DSS

The architecture never receives, processes, or stores cardholder data — the
browser exchanges card details directly with the provider's hosted fields. This
is the scope-minimising model and points toward **SAQ-A**, the lightest
self-assessment. It must be confirmed with the acquirer and a QSA; the eligibility
criteria are specific and depend on exactly how the payment page is composed.

### 3.2 Visa and Mastercard rules

Several network questions are structural for this product, not incidental:

- **Merchant category.** Funding a cash disbursement may be classified as a
  quasi-cash or cash-equivalent transaction rather than a purchase. That
  classification changes interchange, issuer treatment, permitted card types, and
  in some cases whether credit cards may be used at all.
- **Credit card acceptance.** Many issuers treat quasi-cash as a cash advance,
  which charges the cardholder interest from day one with no grace period. If
  that applies, it must be disclosed prominently — a customer who discovers it on
  their statement will dispute the charge.
- **Cross-border and DCC rules.** Rules on cross-border acquiring and dynamic
  currency conversion disclosure.
- **Chargeback rights.** Cardholders retain dispute rights on card-not-present
  transactions. For an irreversible cash payout this is the defining commercial
  risk; see §5.

### 3.3 Acquiring relationship

An acquirer must be willing to board this merchant category and this risk
profile. That is a commercial negotiation as much as a legal one, and it may
require a reserve, a rolling hold, or a personal guarantee.

---

## 4. Banking and payout partnerships

None of the following exists today.

| Dependency | What it means | Why it is hard |
| --- | --- | --- |
| **Settlement bank** | An account able to receive card settlement and fund DOP payouts | Correspondent banking for a money-services business is the most common point of failure for a company like this |
| **Payout network** | Real institutions willing to hand over cash against our codes | Requires their own compliance sign-off on us, plus integration, training, and reconciliation |
| **DOP liquidity / float** | Cash physically present at each window | Partners will not front unlimited cash; float management and pre-funding must be negotiated |
| **Settlement cadence** | When and how partners are reimbursed | Daily net settlement, reserve requirements, dispute handling |
| **Correspondent banking** | Cross-border USD → DOP movement | Subject to the correspondent's own AML posture on our business |

The `PickupInstitution` model carries an `isDemo` flag that is `true` for every
row in this build and drives a mandatory, non-dismissible "DEMO LOCATION — NOT A
REAL PARTNER" banner everywhere a location appears. That flag flips only when a
signed agreement exists.

---

## 5. Chargeback exposure — the defining commercial risk

A card is charged. Pesos are handed to a person who walks out. Weeks later the
cardholder disputes the transaction. The cash is gone and unrecoverable.

The system models this honestly rather than hiding it:

- `PICKED_UP → DISPUTED` is a legal state transition, because it happens.
- A chargeback after disbursement books directly to `EXP_FRAUD_LOSS_USD`. The
  ledger states plainly that the money is gone.
- A `CRITICAL` fraud alert opens automatically.

Mitigations that must be designed with counsel and the acquirer before launch:
KYC before payout (implemented architecturally), delay windows between funding
and collection, per-customer and per-corridor limits, velocity controls, reserve
funding, and a documented evidence pack for representment.

**Unit economics only work if the chargeback rate stays very low.** A platform fee
measured in single-digit percent cannot absorb a chargeback rate measured in whole
percent.

---

## 6. Corporate and operational prerequisites

Entity formation and domicile · beneficial-ownership disclosure · fit-and-proper
assessment of directors · minimum capital, if the licence category prescribes one
· professional indemnity and crime insurance · a designated compliance officer ·
board-approved AML policy · staff training and attestation · record-retention
policy · outsourcing agreements for every vendor · business continuity and
disaster recovery plans · complaint handling and dispute resolution.

---

## 7. Marketing constraints (enforced in this build)

The application is written so it cannot accidentally overclaim:

**What is never said.** That Larimar is licensed, authorised, regulated, or
supervised. That any institution is a partner. That any rate is a market rate.
That any document has been verified. That the service is safer than a bank. That
our rate beats a named competitor.

**What is always said.** A permanent, non-dismissible demo banner on every page.
"DEMO LOCATION — NOT A REAL PARTNER" on every location, in the UI and in the API
response. `isDemoRate: true` on every pricing response while the mock provider is
installed. A dedicated `/trust` page listing what we do not claim. Demo-mode
notices on the identity, fees, and limits surfaces.

The limits shipped in the seed ($1,000/day, $5,000/month) are **arbitrary
engineering defaults**. They are stated as such in the code comment, the seed
output, the fees page, the AML disclosure page, and the FAQ. They are not
Dominican legal thresholds and must never be represented as such.

---

## 8. Expansion — the same work, per country

`src/lib/domain/countries.ts` scaffolds Mexico, Colombia, Costa Rica, Panama,
Jamaica, and Puerto Rico with `enabled: false`. Enabling any of them requires the
whole of sections 2 through 6 repeated for that jurisdiction: local licensing
analysis, a banking relationship, a payout network, local AML rules, local
consumer-protection disclosure, and local data-protection compliance.

Puerto Rico is worth flagging separately: it is a US territory, so US federal
money-transmission rules and FinCEN registration would apply — a different regime
entirely from the rest of the list.

---

## 9. Recommended sequence

1. **Engage Dominican financial-services counsel.** Everything else depends on
   the answer to "is this a regulated activity, and under which category?"
2. **Decide the structure.** Licensed entity, or technology provider to a
   licensed institution. This choice determines the next two years of work.
3. **Secure a banking relationship.** Historically the hardest step; start early.
4. **Engage a payout partner.** Their compliance team will assess us before any
   commercial terms are discussed.
5. **Engage an acquirer.** Confirm merchant category and chargeback treatment.
6. **Build the compliance programme.** Officer, policy, training, monitoring
   thresholds set by counsel — not by engineering defaults.
7. **Contract real vendors.** KYC, sanctions screening, market data.
8. **Independent security assessment.** Penetration test and PCI scoping.
9. **Only then** consider processing real money.

---

## 10. Statement of non-approval

No regulator, bank, payment network, exchange house, or payout institution has
reviewed, approved, endorsed, or authorised this software or the business model
it demonstrates. No such review has been requested. Any statement to the contrary
would be false.
