# Larimar — Security Architecture

**Status:** v0.1 · **Mode:** DEMO
**Scope:** what is implemented, why it was chosen, and what is explicitly missing.

> This document describes a demonstration build. It has not been penetration
> tested, audited, or assessed against PCI DSS, SOC 2, or ISO 27001. Section 12
> lists what is absent, and that list is as important as everything above it.

---

## 1. The threat model this is built against

A cash-out platform has one property that shapes every control: **the payout is
irreversible and the funding is not.** A card can be charged back weeks after the
pesos have been handed to a stranger and walked out of the building. That
asymmetry makes the following the primary adversaries:

| # | Adversary | Objective | Primary controls |
| --- | --- | --- | --- |
| T1 | Card fraudster | Fund with a stolen card, collect cash, disappear | KYC before payout, risk scoring, velocity limits, device signals, chargeback history, compliance hold |
| T2 | Code thief | Obtain a pickup code (shoulder-surf, screenshot, intercepted message) and collect | 40-bit code + 128-bit QR secret + government ID at the window; attempt limits; single redemption |
| T3 | Code guesser | Brute-force the code space | Peppered hashing, per-code attempt cap, cross-code brute-force detection, rate limiting, fraud alerts |
| T4 | Dishonest agent | Mark a payout complete without handing over cash, or pay an accomplice | Location scoping, immutable pickup events, explicit identity assertion, per-agent anomaly detection, separation from compliance |
| T5 | Account takeover | Take over a customer account and redirect or collect funds | Scrypt hashing, session revocation, login anomaly detection, MFA, notification on security events |
| T6 | Insider / support abuse | Use a privileged account to move or release money | Deny-by-default RBAC, separation of duties, append-only audit log, no support access to payout approval |
| T7 | Replay / tamper | Replay a webhook, reuse a signature, alter a request in flight | HMAC over method+path+timestamp+body hash, timestamp windows, unique provider event ids, idempotency keys |
| T8 | Data thief | Exfiltrate the database | No PAN, no full document numbers, hashed codes with an out-of-database pepper, encrypted TOTP and partner secrets |

---

## 2. Card data: the boundary

**No primary account number, CVV, expiry date, or magnetic-stripe data ever
enters this application.**

The client exchanges card details directly with the payment provider using their
hosted fields and a client secret, and hands us an opaque token. What we persist
is the token, the card brand, the BIN, the last four digits, and the issuing
country — the minimum needed for risk scoring and customer recognition.

Two enforcement points make this structural rather than aspirational:

- `confirmPaymentSchema` rejects any `paymentToken` that matches `^\d{12,19}$`
  after stripping separators. A card number sent to this endpoint is a 422.
- `MockPaymentProvider.authorizePayment` throws outright on a card-number-shaped
  token, so a misconfigured client fails loudly during development rather than
  silently logging a PAN.

This is why the mock provider mimics the hosted-field handshake rather than
accepting card fields directly: the demo has the same data boundary the
production integration will have.

---

## 3. Pickup credentials

The pickup code is a bearer instrument for cash. It is designed as one factor of
three, not as a password.

**Format.** `DR-XXXX-XXXX` over a 32-symbol Crockford-style alphabet (no I, L, O,
or U, so nothing is misread across a counter). Eight symbols is **40 bits** —
1,099,511,627,776 combinations. Plain 8-digit numeric codes give 10^8, about
26.6 bits, which is too thin for something redeemable for cash.

**Generation.** `crypto.randomBytes` with rejection sampling. Bytes outside an
exact multiple of the alphabet size are discarded rather than folded with `%`.
Modulo over 256 with a 32-symbol alphabet happens to be unbiased, but the guard
stays so that changing the alphabet later cannot silently introduce bias.

**Second factor.** A 128-bit hex secret is embedded only in the QR payload. A
shoulder-surfer who reads the printed code does not have it.

**Third factor.** A government-issued identity document, checked by the agent
against the transaction's stated requirements.

**At rest.** Only `sha256(pepper ‖ normalizedCode)` is stored. The pepper lives
in the secret store, not in the database, so a full database dump is not a
cash-out opportunity. Comparison is `timingSafeEqual`.

**Delivered once.** The plaintext is returned in the response to payment
confirmation and by no other endpoint, ever. `GET /api/transactions/:id/pickup`
returns status, expiry, and remaining attempts — never the code. Making it
re-retrievable would turn any session hijack into a cash-out and would require
storing something reversible.

**Attempt limiting.** Five attempts per code, then the code locks and a
`CODE_BRUTE_FORCE` alert opens. Attempts are also counted per agent and per
address, because an attacker guessing codes spreads attempts across many codes
precisely to stay under a per-code cap. That is what `detectCodeBruteForce`
catches.

**Single redemption.** Enforced by a conditional `UPDATE ... WHERE status =
'ACTIVE'` inside a `SERIALIZABLE` transaction. Two agents scanning simultaneously
produce exactly one payout; PostgreSQL aborts the loser. This is proven by an
integration test that fires three concurrent redemptions and asserts one success.

---

## 4. Passwords and sessions

**Hashing: scrypt** (N=2^15, r=8, p=1, 64-byte output), from `node:crypto`.
Roughly 32 MB of memory per hash, which is the point — it makes large-scale
offline cracking expensive without making a single login slow. Parameters are
encoded into the stored string (`scrypt$N$r$p$salt$hash`) so they can be raised
later; `needsRehash` triggers a transparent upgrade on next successful login.

No third-party crypto dependency, deliberately: Node's built-ins cover
everything needed and remove a supply-chain risk from the most security-sensitive
code in the system.

**Sessions: opaque random tokens, not JWTs.** A cash platform needs instant,
reliable, server-side revocation. "The token expires in fifteen minutes" is not
an acceptable answer to suspected fraud. Tokens are 256 bits of CSPRNG output,
stored as an unsalted SHA-256 digest (correct here — the input is already
uniformly random, so there is no dictionary to defend against, and an unsalted
digest keeps lookup a single indexed match).

Two clocks run on every session: an absolute deadline (default 12h) caps total
lifetime, and an idle deadline (default 30m) closes abandoned sessions on shared
or hotel devices. The idle window slides, written at most once a minute so a busy
session does not turn every request into a write.

**Rotation.** A new token is issued and the old one revoked on privilege change
(MFA completion), so a token captured beforehand cannot reach the new privileges.

**Cookies.** `HttpOnly; Secure` (in production); `SameSite=Lax`. Lax rather than
Strict because a traveler following an emailed receipt link should still arrive
logged in — and state-changing routes are additionally origin-checked, so Lax
does not weaken CSRF defence here.

**Mass revocation.** A password reset revokes every session for the account. If
the reset was an attacker recovering an account, this evicts them; if it was the
owner, re-authenticating is cheap.

**Account lockout.** Eight failed attempts locks for 15 minutes and sends a
security notification.

---

## 5. Multi-factor authentication

RFC 6238 TOTP on `node:crypto` HMAC-SHA1, 6 digits, 30-second period, ±1 step
window for clock skew. Every candidate step is compared with `timingSafeEqual`
and the loop always runs to completion, so response timing does not reveal which
step matched.

Secrets are 160 bits (the RFC 4226 recommendation), stored **encrypted** with
AES-256-GCM under the platform encryption key. Recovery codes are stored hashed
and are single-use.

**MFA is mandatory for every staff role.** An agent account dispenses cash and a
compliance account releases held funds; a password alone is not an adequate
control on either.

> **Demo-mode exception.** With `DEMO_MODE=true`, staff accounts sign in without
> the TOTP challenge so the platform is walkable from a fresh clone. This is
> gated on the environment flag and is listed in §12 as a production blocker.

---

## 6. Authorisation

Deny by default. A route declares the permission it needs; a route with no
declared permission is unreachable by any non-admin principal, and stating
`permission: null` for a genuinely public endpoint makes that a visible decision
in the code rather than an omission.

The permission map is data (`src/server/auth/rbac.ts`), which means the entire
access matrix is asserted in one test file rather than inferred from scattered
conditionals.

Two separations of duty are load-bearing:

- **A `SUPPORT_AGENT` can read everything about a transaction and change
  nothing.** No payout approval, no refund, no status change, no hold release.
  Support is the most socially-engineered role in any payments company.
- **`SYSTEM_ADMIN` cannot release compliance holds or review KYC.** The person
  who configures the platform does not also clear its holds.

**Location scoping.** An agent may act only at locations in their active
assignments. This is checked *in addition to* the permission, never instead of
it, and it is checked before a code is even looked up — so an agent cannot probe
codes against a location they do not staff.

**Defence in depth.** Route-group layouts check authorisation server-side before
any child renders, *and* every API endpoint checks again. Hiding a navigation
link is presentation, not security.

---

## 7. Input validation and output encoding

Every request body and query string is parsed with a Zod schema, and every schema
is `.strict()`. An unknown field is rejected rather than ignored — that is what
stops a client smuggling `{ amount: 1, status: "PICKED_UP" }` past a handler that
happens to spread its input somewhere.

Schemas are the single source of truth: the route handlers parse with them and
the OpenAPI document is generated from them, so documentation cannot drift.

**SQL injection** is structurally prevented by Prisma's parameterised queries.
The one raw query in the codebase is `SELECT 1` in the health check.

**XSS** is prevented by React's default escaping. There is no `dangerouslySet
InnerHTML` anywhere in the codebase, and the CSP forbids inline script.

**Error responses** go through one translator. 4xx domain errors carry their
message through because they are written for customers; anything 5xx is replaced
with a generic message, so a stack trace, an internal detail, or a raw database
error never reaches a client.

---

## 8. Transport and browser security

Set in `next.config.mjs` on every response:

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'`, no inline script, no third-party origins | This application handles a cash bearer credential. No CDN, no analytics, no external font host. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | |
| `X-Frame-Options` / `frame-ancestors` | `DENY` / `'none'` | Clickjacking a payout approval button |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Transaction ids must not leak in referrers |
| `Permissions-Policy` | camera, microphone, payment disabled | |
| `Cross-Origin-Opener-Policy` | `same-origin` | |

`'unsafe-inline'` is permitted for **styles only**, required by Next's style
injection. Scripts get `'self'` and nothing else.

**CSRF.** `SameSite=Lax` cookies plus an origin check on every state-changing
request. A cross-site form post carries an `Origin` the server rejects, and a
cross-site `fetch` cannot forge one.

---

## 9. Idempotency and concurrency

Every mutating financial endpoint requires an `Idempotency-Key`. The key, route,
actor, and a **canonical hash of the request body** (keys sorted, so `{a,b}` and
`{b,a}` are the same request) form a unique row.

- Same key, same body → the stored original response.
- Same key, different body → `409`. The key is a promise about the request.
- Same key, still in flight → `409` with a retry hint, rather than executing twice.

The unique constraint on `(scope, key)` makes the reservation atomic; the code
merely interprets the constraint violation. On handler failure the key is
released so a legitimate retry can proceed — leaving it reserved would
permanently block a customer whose first attempt hit a transient error.

Concurrency-sensitive operations run at `SERIALIZABLE` with conditional updates
asserting the expected prior state. The database, not application logic, is the
arbiter.

---

## 10. Webhooks and partner API

Both verify an HMAC-SHA256 signature **and** a timestamp inside a tolerance
window (default 300s). A valid signature on a replayed old request is still an
attack, so the timestamp check is not optional — and the timestamp is inside the
signed payload, so it cannot be altered.

The raw request bytes are read before any parsing, because re-serialising JSON
would change whitespace and break verification.

A third guard: the provider's own event id is unique-constrained, so a replay of
a valid, in-window event is rejected. Invalid-signature attempts are recorded as
`WebhookEvent` rows with status `INVALID_SIGNATURE` — an attacker probing the
endpoint leaves a trail.

The partner API signs `METHOD\nPATH\nTIMESTAMP\nSHA256(body)`. Binding the method
and path is what stops a signature captured from a read-only call being replayed
against the redeem endpoint. Partner secrets are AES-256-GCM encrypted at rest,
and an unknown key id returns the same error as a bad signature so key ids cannot
be enumerated.

---

## 11. Secrets, encryption, and logging

Secrets come from environment variables, validated at import by
`src/server/env.ts`. A missing or placeholder secret fails the process at startup
rather than surfacing three layers deep during a payment. `ENCRYPTION_KEY` must
decode to exactly 32 bytes or the process refuses to boot.

**The DEMO_MODE interlock.** With `DEMO_MODE=false`, the application refuses to
start if any provider is still `mock`. It is structurally impossible to run a
build that claims not to be a demo while simulating money movement.

**Encryption at rest** for TOTP secrets and partner API secrets: AES-256-GCM,
authenticated, versioned format (`v1.iv.tag.ciphertext`) so the scheme can be
rotated unambiguously.

**Audit logging** is append-only — there is no update or delete path anywhere in
the application. Every payload passes through `redact()`, which recursively
strips ~20 sensitive key names (password, token, secret, PAN, CVV, code, document
number, authorization, cookie…) before write. Callers are expected not to pass
secrets; this runs anyway.

Pickup codes are masked as `DR-****-7316` wherever they appear in logs or audit
metadata. Notification recipients are redacted in development logs. The pickup
credential itself is never audited — only the fact that one was issued.

**Rotating `PICKUP_CODE_PEPPER` invalidates every outstanding pickup code.** This
is stated in `.env.example` next to the variable.

---

## 12. What is missing — production blockers

Stated plainly, because an incomplete security posture presented as complete is
worse than none.

| Gap | Impact | Required before real money |
| --- | --- | --- |
| **MFA bypass in demo mode** | Staff sign in without TOTP when `DEMO_MODE=true` | Remove the bypass; enforce enrolment |
| **Password reset token logged** | Reset tokens print to the console in demo mode | Delete that line; deliver by email only |
| **Rate limiting is database-backed** | Fixed windows allow boundary bursts; adds DB load | Move to Redis with a sliding window |
| **Idempotency is database-backed** | Same | Move to Redis |
| **Secrets in environment variables** | No rotation, no access audit, present on disk | KMS / Secrets Manager with automatic rotation |
| **Device fingerprint is trivially spoofable** | Weakens one risk signal (never an auth factor) | Dedicated device-intelligence vendor |
| **Sanctions screening is a fixture list** | Matches four strings, not a sanctions database | Real vendor: OFAC, UN, EU, UK HMT, local lists, fuzzy matching |
| **KYC is simulated** | No document is authenticated | Vendor with document + biometric liveness |
| **No PCI DSS assessment** | Unknown compliance posture | SAQ-A at minimum, given the tokenisation model |
| **No penetration test** | Unknown vulnerabilities | Independent test before launch, then annually |
| **No WAF / DDoS protection** | Availability and L7 attack exposure | CDN with WAF |
| **No security monitoring or SIEM** | Audit logs are written but not watched | Alerting on the audit stream |
| **No key rotation procedure** | Rotating the pepper breaks live codes | Versioned pepper with dual-read during rotation |
| **No incident response plan** | Undefined behaviour under compromise | Documented IR plan, on-call, breach notification path |
| **Single region, no DR** | Availability | Multi-AZ, tested restores |
| **No backup encryption or restore drill** | Data loss risk | Encrypted backups, periodic restore tests |

---

## 13. Reporting a vulnerability

This is a demonstration repository with no production deployment and no bug
bounty. If you find something, open a GitHub issue — but please do not include
working exploit payloads against any third-party system.

For a real deployment, this section would carry a security contact address, a PGP
key, a disclosure policy with response timelines, and a safe-harbour statement.
