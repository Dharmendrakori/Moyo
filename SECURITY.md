# Security

## Scope and honesty statement

This document describes the security controls **implemented in this repository**
and the controls that **must still be added before production use**.

**This application is not "vulnerability-free", and no claim to that effect
should be made.** Security is a property of a deployed system, not of source
code alone. What follows is an account of what was built and verified, plus an
explicit list of what remains outstanding. Treat section 6 as a launch
checklist, not optional reading.

Verification performed for this release (Milestone 2.5, measured on this
working tree — 27 suites, 372 tests):

| Check | Command | Result |
| --- | --- | --- |
| Type safety | `npm run typecheck` | PASS (0 errors) |
| Lint | `npm run lint` | PASS (0 errors) |
| Unit tests | `npm test` | PASS (372 tests, 27 suites) |
| Production compile | `npx next build` | PASS |
| Production build script | `npm run build` | **PASS** — `prisma generate` ✔ (Prisma Client 5.22.0) then `next build` ✔ (29 routes). See the README changelog for the Windows file-lock cause that previously blocked it |
| Dependency audit (runtime) | `npm run audit:prod` | 0 vulnerabilities |

---

## 1. What is implemented

### 1.1 Authentication

- **Passwords**: bcrypt with cost factor 12 (`src/lib/crypto.ts`). Plaintext is
  never stored, logged or returned.
- **Sessions**: opaque, database-backed (`src/lib/auth.ts`). A 256-bit random
  token is issued; only its SHA-256 hash is stored, so a database disclosure
  does not yield usable cookies.
- **Session fixation**: a brand-new session row is created on every successful
  login; the previous token is never reused.
- **Cookie configuration**: `HttpOnly`, `SameSite=Lax`, `Secure` in production,
  `Path=/`, 12-hour expiry.
- **Why not JWT**: a self-contained token cannot be revoked. With database
  sessions, logout, role changes and account suspension take effect on the very
  next request.
- **Brute force**: IP-keyed rate limit (8 attempts / 15 min) plus per-account
  lockout after 5 consecutive failures.
- **User enumeration**: unknown accounts still perform a bcrypt comparison
  against a dummy hash, and every failure mode returns identical text.
- **No hard-coded credentials**: the admin account is created only when
  `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are supplied via the
  environment. There is no default password anywhere in the codebase.

### 1.2 Authorization (RBAC + object-level)

Roles: `CUSTOMER`, `PROVIDER`, `TECHNICIAN`, `ADMIN`.

- **Never trusted from the client**: user id, role, price, booking ownership,
  payment status, provider id and technician id are resolved server-side.
- **IDOR prevention** (`src/lib/access.ts`): queries are *scoped by ownership
  column*, never fetched by id and checked afterwards. A record belonging to
  someone else is never loaded into memory.
- **Not-found vs not-yours**: both return `404`, so the endpoints cannot be
  used to discover which record ids exist.
- **Customer booking reads** (`src/lib/customer-bookings.ts`): the owning
  customer's id is not a function parameter, so it cannot be supplied by a
  caller.
- **Route guards are defence in depth**: `/admin` is gated in the layout *and*
  re-checked in every admin page and API route. Hiding a nav link is never the
  control.

### 1.2a Admin authorization and the operations console

The admin surface added in this milestone enforces authorization at the server
boundary at every layer.

- **One guard, one chain** (`src/lib/admin-api.ts`). Every `/api/admin/**` route
  calls `adminReadGuard()` or `adminWriteGuard()`, which run
  `assertSameOrigin → requireAdmin → assertCsrf → rate limit` **before the
  request body is parsed and before any database write is attempted**. There is
  no admin route that authorises itself any other way.
- **Role comes from the database, every request.** `getCurrentUser()`
  re-validates the stored role with `isRole()` before it is used in any decision,
  and sessions are opaque and database-backed, so logout, demotion and suspension
  take effect on the next request. There is no JWT that could carry a stale claim.
- **Three independent layers.** The Edge `proxy.ts` (cookie *presence* only, no
  database), the admin layout, and per-page/per-route checks. Removing any one
  does not remove the protection.
- **401 vs 403 are distinguishable.** No session → `401`; wrong role → `403` with
  an explicit access-denied page that renders no admin chrome and no data. A
  signed-in non-admin is not silently bounced to `/login`, which would loop and
  hide the reason.
- **No client-side authorization.** The nav renders disabled entries for modules
  that are not built, but that is a usability device. Nothing is protected by it,
  and there is no role check in the browser.
- **Row ids are format-validated** (`readIdParam`) before any lookup, and a
  malformed id returns the same `404` as a real-but-missing one, so the endpoints
  cannot be used to probe the id format or enumerate records.

### 1.2b Commercial mutations

- **No mass assignment.** Every admin mutation schema is `.strict()` and exposes
  only the commercially editable fields. An unexpected key (`serviceId`, `id`,
  `role`, `isActive` on the wrong endpoint) **rejects the whole request** rather
  than being silently ignored - otherwise a caller could believe a change had
  been made when it had not. The targeted record always comes from the URL path,
  never from the body.
- **Authoritative catalogue fields are not writable at all.** `Category.name`,
  `.code`, `.position` and `Service.name`, `.slug`, `.serviceType` are absent from
  every mutation schema. They cannot be changed even by a hand-crafted request.
- **Price is not settable from the charging-options endpoint.** Enabling an option
  and publishing its price are separate operations, with separate schemas and
  separate audit actions, so activation can never expose a price as a side effect.
- **Publish guards.** A price cannot be published against a disabled option or a
  deactivated service, so a customer is never shown a price the booking domain
  would reject as unavailable. Customer Budget cannot carry a fixed price at all.
- **Customer Budget range semantics are enforced server-side.** Budget bounds are
  rejected on Visit Charge and Fixed Charge, and a budget option cannot be enabled
  without bounds, because the booking domain would reject every resulting request.
- **Historical quotes are immutable.** `Booking.quotedPaise`,
  `budgetMinPaise` and `budgetMaxPaise` are snapshots taken at creation. The
  pricing mutation path writes only to `ServiceOption` and never reads or writes a
  `Booking` row, so re-pricing the catalogue cannot retroactively change an agreed
  quote. A test asserts this, and the test mock throws on any booking write so a
  future regression fails loudly.
- **Minimisation.** Every admin query uses an explicit `select`. No password hash,
  session token, IP hash or unrelated personal column is ever fetched, so none can
  reach the browser.
- **Generic errors.** Unexpected failures are logged server-side and returned as a
  fixed `500`. No stack trace, SQL fragment or Prisma message is serialized to a
  client, and the admin UI renders API messages as text, never as HTML.

### 1.3 Booking state machine

`src/lib/booking-state.ts`

- Only declared transitions are permitted; forward skips and backwards moves
  are rejected.
- Roles are keyed **per transition edge**, not per source state, so a
  technician may mark work complete but may **not** issue an invoice.
- **`PAYMENT_PENDING -> PAID` has no permitted role at all.** It is reachable
  only through the verified payment webhook. An automated test asserts this,
  because an accidental entry would let anyone bypass payment.
- Every transition writes an append-only `BookingStatusEvent` row.

### 1.4 Pricing integrity

`src/lib/pricing.ts`

- A client selects *which* charging option applies; the *amount* is always
  resolved server-side from `ServiceOption`.
- A price posted by a client is ignored entirely.
- Customer budgets are range-validated against provider-published bounds with an
  absolute floor and ceiling.
- Money is stored as integer paise to avoid floating-point drift.

### 1.5 Payments

`src/app/api/webhooks/payment/route.ts`

- **A booking cannot be marked paid by a user.** The webhook is the only path.
- **Signature verification**: HMAC-SHA256 over the **raw** request body,
  compared with `timingSafeEqual`. The body is read as text before JSON
  parsing because re-serializing parsed JSON does not reproduce the signed
  bytes.
- **Idempotency**: keyed on the provider event id, so an aggressive provider
  retry cannot double-apply a settlement.
- **Amount verification**: the webhook amount is compared against the stored
  invoice total; a mismatch is rejected.
- **No card data is ever stored.** Only an opaque provider reference and an
  optional masked last-4.
- **Fails closed**: with no payment provider configured the endpoint returns
  `503` rather than simulating a successful charge.

### 1.6 Input validation

`src/lib/validation.ts`

- Every API route validates its input with Zod before touching the database.
- Length caps on every string; allowlisted enums instead of free-form strings.
- `strict()` on request objects, so **mass assignment is rejected outright** -
  posting `role`, `status` or `quotedPaise` fails validation.
- Request bodies are size-capped before parsing (64 KB default, 413 above).
- Indian phone numbers and PIN codes are normalized and strictly validated.
- Client-side validation is treated purely as UX.

### 1.7 CSRF

- Double-submit pattern with a **server-stored, per-session** CSRF token.
- Verified on every mutating API route via `assertCsrf`.
- Backed by an `Origin` check as defence in depth.
- The token is minted only at session creation, never on demand.

### 1.8 File uploads

`src/lib/uploads.ts`

Six independent layers, all of which must pass:

1. Declared size rejected before the body is read; re-checked after buffering.
2. MIME-type allowlist (JPEG, PNG, WEBP only).
3. Extension allowlist that must agree with the declared type.
4. **Magic-number ("file signature") verification** against the actual bytes,
   so a renamed executable cannot masquerade as an image.
5. Server-generated random filename. The user filename is never used to build a
   path, and the stored key is constrained by a strict regex.
6. Storage outside the Next.js `public/` web root; retrieval only through an
   authorized route handler.

SVG is deliberately excluded (it is an XSS vector).

### 1.9 Cross-site scripting

- The refactor removed every `innerHTML` site from the legacy page, including
  the search dropdown that interpolated a raw query string - a live DOM XSS.
- All rendering goes through React escaping; `react/no-danger` is set to
  **`error`** in `eslint.config.mjs` so it cannot regress.
- **No third-party JavaScript or CSS executes on any page.** The Font Awesome
  and Google Fonts CDN dependencies were removed entirely.
- CSP is served with a per-request nonce (see 1.10).

### 1.10 Security headers

Applied by `src/proxy.ts` (per-request) with a static fallback in
`next.config.mjs`. Verified present on a live response:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'`; `object-src 'none'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `connect-src 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera/microphone disabled, payment self-only |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (production only) |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cache-Control` | `private, no-store` for authenticated HTML |

### 1.11 Audit logging

`src/lib/audit.ts` records logins, failed logins, logouts, booking creation and
status changes, technician assignment, payment status changes, material order
changes, role changes and access denials.

- Audit failures never break the request they describe.
- Metadata carries operational facts only - **never** passwords, tokens, card
  data or full customer addresses.
- Client IPs are stored as salted HMACs, never in the clear.

### 1.12 Error handling

- Unexpected errors are logged server-side and returned to the client as a
  generic `500`. Stack traces, SQL and Prisma messages are never serialized.
- Zod failures return only field names and safe messages.

### 1.13 Secrets management

- `.env` is gitignored; `.env.example` documents every variable with empty
  values.
- `scripts/setup-env.mjs` generates a fresh random `SESSION_SECRET` locally.
- The server refuses to boot if required configuration is missing, and enforces
  a 32-character minimum `SESSION_SECRET` in production.
- No API keys, JWT secrets, database credentials or payment secrets appear in
  the repository.

---

## 2. Threats explicitly addressed

| Threat | Control |
| --- | --- |
| XSS | React escaping, `react/no-danger: error`, strict CSP with nonce, no third-party scripts |
| SQL injection | Prisma parameterised queries throughout; no string-built SQL |
| NoSQL injection | Prisma with a relational schema; all inputs Zod-validated and coerced |
| CSRF | Per-session double-submit token + Origin check on every mutation |
| IDOR / broken object-level authorization | Ownership-scoped queries (`access.ts`, `customer-bookings.ts`) |
| Privilege escalation | Role never read from the client; `registerSchema.strict()` rejects a posted `role` |
| Mass assignment | `.strict()` Zod objects reject unknown keys |
| Insecure direct API access | `apiHandler` wrapper enforces auth, validation and safe errors on every route |
| Session fixation | New session token minted on every login |
| Session theft | Opaque hashed tokens, `HttpOnly`, `Secure`, `SameSite`, revocation endpoint |
| Brute force / credential stuffing | IP rate limiting, per-account lockout, uniform error responses |
| Open redirect | `safeRedirectPath` rejects absolute, protocol-relative, `javascript:`, backslash and control-character targets (unit-tested) |
| SSRF | No arbitrary remote images (`remotePatterns: []`), no user-supplied URLs fetched server-side |
| Malicious file uploads | Six-layer validation incl. magic-number checks, random names, storage outside the web root |
| Path traversal | Strict storage-key regex plus path-containment assertion |
| Command injection | No shell invocation anywhere in the codebase |
| Unsafe HTML rendering | No `innerHTML`, no `eval`, no `Function()`, no `dangerouslySetInnerHTML` |
| CORS misconfiguration | No permissive CORS headers; same-origin only |
| Information leakage | Narrow DB projections; hashed IPs; generic error responses; `noindex` on admin |
| Payment fraud | Webhook-only settlement, signature verification, idempotency, amount cross-check |
| Dependency vulnerabilities | Audited; runtime tree reports **0 vulnerabilities** |

---

## 3. Automated test coverage

372 tests across 27 suites (`npm test`). The security-relevant ones:

- **`tests/booking-state.test.ts`** - legal/illegal transitions, terminal
  states, per-edge role permissions, and that **no role including `ADMIN` can
  set `PAID`**. Also asserts the status hints never promise an ETA, a guarantee
  or "100%".
- **`tests/validation.test.ts`** - phone/PIN normalization, budget bounds,
  password strength, and rejection of mass-assignment payloads.
- **`tests/security.test.ts`** - open-redirect bypass patterns, and role/status
  narrowing of stored values.
- **`tests/admin-auth.test.ts`**, **`tests/proxy-guard.test.ts`**,
  **`tests/auth-url-security.test.ts`** - admin guard chain, middleware
  boundaries and redirect safety.
- **`tests/admin-booking-detail.test.ts`** - the admin booking read is 401/403
  for non-admins, 404 for unknown and malformed ids (without touching the
  database), and its projection selects **no customer account email or phone**.
- **`tests/admin-booking-dispatch.test.ts`** - confirm and assign: success,
  CSRF required, invalid transitions blocked (409), inactive technician refused
  (422), repeated mutation refused, CUSTOMER driver refused, and a status event
  written only on a real transition.
- **`tests/admin-sidebar.test.ts`** - the collapsed sidebar can always be
  expanded again, the mobile drawer stays independent, and the remembered
  preference arrives from the server (no hydration-sensitive initialisation).

These tests found and fixed genuine defects during development: `ADMIN` could
previously mark a booking `PAID`, and the desktop sidebar could previously be
collapsed into a state from which the expand control had disappeared.

---

## 4. Dependency security posture

`npm run audit:prod` (`npm audit --omit=dev --audit-level=moderate`) reports
**0 vulnerabilities** in the runtime tree.

| Package | Version | Note |
| --- | --- | --- |
| `next` | `16.4.3` | Upgraded from `16.3.8` in Milestone 2.5 |
| `zod` | `4.6.7` | Upgraded from `3.25.76` in Milestone 2.5 |
| `react` / `react-dom` | `19.3.0` | Unchanged |
| `@prisma/client` | `5.22.0` | Unchanged |

Advisories resolved in Milestone 2.5 (all were present at `16.3.8` / `3.25.76`, and
none were introduced by this repository's own code):

- `GHSA-2464-fhr4-w9xw` (critical) - unauthenticated RCE in the Image
  Optimization API when SVG is used. Fixed by Next.js `16.4.1+`.
- `GHSA-673q-mjm6-r5xr` (critical) - unauthenticated RCE in `use cache`
  functions returning typed arrays. Fixed by Next.js `16.4.1+`.
- `GHSA-p3m5-59mp-jv5r` (high) - denial of service in App Router Server
  Actions. Fixed by Next.js `16.4.1+`.
- `GHSA-mrhx-c7xc-m3w5` / CVE-2023-54404 (high) - zod could exhaust memory while
  validating an oversized array against an unconstrained array schema. Patched
  in zod `4.6.6`; this project moved to `4.6.7`.

The zod change is a **major** version upgrade, so it was not taken on trust:
`npm run typecheck` and the full suite were run against it and pass unchanged.
Zod 4 deprecates some v3 APIs; two are used here and both still work in 4.6.7
with identical behaviour:

| Deprecated in zod 4 | Recommended replacement | Used at | Migration status |
| --- | --- | --- | --- |
| `z.object({...}).strict()` | `z.strictObject({...})` | 41 call sites in `src/lib/validation.ts` | **Not migrated** — a mechanical but wide change inside the primary validation boundary; scheduled as its own task |
| `z.string().email()` | `z.email()` | `emailSchema` (chained after `.trim().toLowerCase().max(254)`) | **Not migrated** — v4 string formats do not carry the same `.trim()`/`.toLowerCase()` chain, so a naive swap would change normalisation |

Neither deprecation is a vulnerability: the v3 aliases remain functional and are
not scheduled for removal before zod 5. A future migration has a safety net
already in place — `tests/validation.test.ts` pins unknown-key rejection
(mass-assignment defence) and email normalisation
(`Rahul@Example.COM` → `rahul@example.com`), which are exactly the behaviours a
careless migration would break.

**Development-only note:** `npm audit` *without* `--omit=dev` still reports one
high finding - the zod advisory against a `zod@3.25.76` copy nested under
`eslint-config-next → eslint-plugin-react-hooks → zod-validation-error`. That
copy is lint-time only, is absent from the production tree, and cannot be
replaced until that plugin widens its peer range. It is not suppressed and not
excluded from the audit.

---

## 4a. Customer personal data — what the admin console may read

Data minimisation is applied at the projection, not at the view, so an operator
cannot obtain a field the screen does not need even by inspecting the response:

| Field | Read by the admin booking detail? | Why |
| --- | --- | --- |
| Booking `contactName`, `contactPhone` | Yes | The customer supplied these for this visit; a technician needs them to arrive and call. |
| Full service address | Yes | The work happens there. |
| Customer account `name`, `id`, `createdAt` | Yes | Support reference and "customer since". The id is opaque. |
| Customer account `email`, `phone` | **No** | Not needed to dispatch a booking; they are the same person's data under a different scope. Account-level contact belongs to a future Customers module with its own access policy. |
| Password hash, sessions, IP hashes, payment provider refs | **No** | Never selected by any console or customer query. |

`tests/admin-booking-detail.test.ts` asserts the absence of the account email and
phone **on the Prisma `select`**, so a future edit that re-adds them fails the
suite. The customer-facing endpoints never carried these fields at all.

Why the remaining fields stay: removing the booking contact would break dispatch
(hiding a phone number does not make the visit happen), and the requirement is
proportionality, not zero exposure. Every one of these reads is behind
`requireAdminPage` on the page and `adminReadGuard` on the API, so a customer
session cannot reach any of it (covered by the 401/403 tests).

---

## 5. Controls that are partial or conditional

Stated plainly rather than presented as complete:

- **Rate limiting is per-process.** The in-memory store means each instance
  enforces its own quota, so the effective limit multiplies by instance count.
  See 6.1.
- **Payment integration is unverified end to end.** The webhook handler is
  implemented and tested in isolation, but no real provider is configured. The
  signature scheme must be adapted to the chosen provider.
- **CSRF relies on `SameSite=Lax` plus token.** Adequate for this
  architecture, but tokens remain the real control.
- **Audit log retention** has no policy implemented.
- **There is no WAF, bot defence or DDoS protection in the application layer.**

---

## 6. Required before production

**This list is not optional.**

### 6.1 Infrastructure

1. **Replace the in-memory rate limiter with Redis** (or equivalent shared
   store) before running more than one instance.
2. Run behind **HTTPS only**. HSTS is already set; terminate TLS correctly.
3. Serve `security.txt` (`/.well-known/security.txt`) and set up a
   vulnerability-disclosure contact.
4. Add DDoS protection at the edge.
5. Restrict database network access to the application only.

### 6.2 Secrets

6. Provide all secrets through the platform's secret manager. Never an `.env`
   file committed or baked into an image.
7. Rotate `SESSION_SECRET` on any suspicion of compromise; doing so invalidates
   all sessions, which is the intended behaviour.

### 6.3 Database

8. **Move off SQLite for production.** Set the Prisma datasource provider to
   `postgresql`, then run a migration. Update `DATABASE_URL` accordingly.
9. **Promote the documented string columns to native enums** once on
   PostgreSQL, for database-level enforcement.
10. Enable encrypted connections (`sslmode=require`) and use a managed service
    with automated backups.

### 6.4 Payments

11. Integrate a real payment provider and **update `verifySignature()` to match
    that provider's exact signing scheme**.
12. Configure `PAYMENT_PROVIDER` and `PAYMENT_WEBHOOK_SECRET` from the secret
    manager.
13. Test the webhook against the provider's sandbox before going live.

### 6.5 Operations

14. Set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` once to bootstrap the first
    admin, then **remove them from the environment**. The current development
    database has **no ADMIN account** (`admins: 0`) precisely because these are
    blank; the console is unreachable until this is done. Note that the admin
    login address does **not** have to be the provider contact address - the
    account that already uses `dharmendra.kori@outlook.com` is a CUSTOMER and
    must stay one.
15. **Rotate the provider operator account's login address.** It still holds a
    retired address from before the MOYO rename. It is not used to authenticate
    against the console and was deliberately not rewritten automatically,
    because changing a live account's login is an identity decision rather than a
    cosmetic one. Do it deliberately.
16. Implement password reset and email verification flows (routes not yet
    built). Note that the provider account is provisioned with an unusable random
    password, so it is currently only reachable via reset.
16. Define audit-log retention and ship logs to an append-only store. The
    commercial audit events added in this milestone
    (`PRICE_PUBLISHED`, `PRICE_UNPUBLISHED`, `CHARGING_OPTION_CHANGED`,
    `CATEGORY_STATUS_CHANGED`, `SERVICE_STATUS_CHANGED`) are written to the
    database today, but there is **no screen to browse them yet** and no
    retention policy.
17. Add dependency scanning to CI (`npm audit` is not currently a build gate).
18. Add SAST/DAST and a dependency-update bot.
19. Perform an independent penetration test before handling real payments.

### 6.6 Privacy

20. Publish a privacy policy and terms of service. The footer links to
    `/privacy` and `/terms`, which **are not yet implemented**.
21. Define data-retention and deletion procedures to satisfy applicable
    obligations (DPDP Act in India, GDPR where applicable).
22. Confirm the provider's published contact details before public launch.