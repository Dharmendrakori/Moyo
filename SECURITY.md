# Security

## Scope and honesty statement

This document describes the security controls **implemented in this repository**
and the controls that **must still be added before production use**.

**This application is not "vulnerability-free", and no claim to that effect
should be made.** Security is a property of a deployed system, not of source
code alone. What follows is an account of what was built and verified, plus an
explicit list of what remains outstanding. Treat section 6 as a launch
checklist, not optional reading.

Verification performed for this release (Milestone 5.1 - technician UX fixes and bulk
management, measured on this working tree - 40 suites, 628 tests):

| Check | Command | Result |
| --- | --- | --- |
| Type safety | `npm run typecheck` | PASS (0 errors) |
| Lint | `npm run lint` | PASS (0 problems) |
| Unit tests | `npm test` | PASS (628 tests, 40 suites) |
| Production compile | `npx next build` | PASS (34/34 static pages, including `/api/admin/technicians/bulk` and `/api/admin/technicians/export`) |
| Production build script | `npm run build` | **BLOCKED on this machine**: `prisma generate` failed with `EPERM` renaming `query_engine-windows.dll.node`, held by lingering node processes from earlier builds that this session cannot terminate (access denied). No schema changed in this milestone, so the generated client is already current |
| Dependency audit (runtime) | `npm run audit:prod` | 0 vulnerabilities |

**Test budget note.** Each suite lazily imports its route graph inside the first test
of the file, so that test also pays the transform cost. While a `next dev` server was
recompiling in the background, that cost exceeded Vitest's default 5 s budget and
first tests failed on time; the same suite passes unchanged (589/589, ~15 s) on a quiet
machine. The committed configuration was deliberately **not** relaxed, because raising
a global timeout would also hide a genuine hang.

**Not verified in this environment:** any interaction with the real Razorpay
sandbox. No test credentials were available and webhooks cannot be delivered to
`localhost`, so checkout and webhook delivery are exercised only by automated
tests that reproduce the documented payloads and signatures. See §6.4.

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
- **Technician boundary**: a TECHNICIAN session holds no elevated rights. Every
  `/api/admin/**` route re-checks for the ADMIN role, so a technician cannot assign
  work, issue an invoice or read a ledger by role. Their own surface is defined by a
  dedicated guard — see §1.2c.

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

### 1.2c Technician accounts, the portal and feature enforcement

`src/lib/technician-features.ts`, `src/lib/technicians.ts`,
`src/lib/technician-access.ts`.

**Two capabilities, stored in a dedicated typed model.** `TechnicianFeatureConfig`
is one row with two boolean columns (`adminManagementEnabled`, `portalEnabled`). It is
deliberately *not* the generic `Setting` key/value table: that stores text and lets a
caller invent keys, so "false" becomes a truthiness question exactly where an
authentication decision is made. Here the key set is closed, and **an absent row, an
unreadable row or a database error falls back to the defaults** (management ON,
portal OFF) — a configuration failure can never enable technician sign-in.

**Four independent gates before a technician sees anything**
(`requireTechnicianPage` / `requireTechnicianApi`):

1. the portal feature is enabled;
2. a live, unrevoked, unexpired session exists;
3. the role read from the database is exactly `TECHNICIAN`;
4. a linked `Technician` profile exists **and is active**.

`ADMIN`, `PROVIDER` and `CUSTOMER` sessions fail gate 3, and the technician id is
taken from the session — never from a parameter — so no request can widen scope. The
portal pages `404` when the feature is off, because a page that does not exist must
not advertise itself.

**Ownership is in the query.** `getTechnicianJob(technicianId, id)` and
`listTechnicianJobs(technicianId)` put the session's technician id in the `WHERE`
clause, so a colleague's booking is indistinguishable from a nonexistent one.

**PII minimisation in the portal.** The job projection selects the visit address,
the dispatch contact the customer supplied for that visit, and the status history. It
does **not** select the customer's account email or phone, the invoice, the payments,
or any administrative note. A test pins that projection.

**No technician-side mutation exists in this release.** The four dispatch transitions
are the next milestone; until then a technician session cannot move a booking, and
every `/api/admin/**` route refuses it by role (asserted by test).

**Account provisioning without an email system.** A technician login is created with
an **unusable password hash** plus a single-use activation token; only the token's
SHA-256 hash is stored. The activation path is returned to the administrator
**exactly once**, delivered out of band, expires in 7 days, is cleared on first use,
and is consumed under a conditional update so two concurrent activations cannot both
succeed. The technician chooses their own password — no administrator ever learns it,
and no default or shared password exists in the codebase. The token travels as a path
segment rather than a query parameter because the edge proxy strips
credential-bearing query parameters from every GET URL.

**Session revocation.** Sessions are database rows, so both a portal disable and a
technician deactivation revoke live sessions **immediately** (`Session.revokedAt`),
and the very next request fails. Deactivating a profile also disables its linked
login, so "active profile, unusable account" cannot arise.

**Nothing is deleted when a capability is switched off.** No booking, assignment,
invoice, payment, technician, account or audit row is removed or rewritten; only the
surfaces close and the writes refuse (`403 ADMIN_MANAGEMENT_DISABLED` /
`403 PORTAL_DISABLED`).

### 1.2d Bulk technician operations

`POST /api/admin/technicians/bulk`, `GET /api/admin/technicians/export`.

**One guarded boundary.** Bulk writes reuse the full admin chain
(`assertSameOrigin → requireAdmin → assertCsrf → rate limit`) and then the same
management feature switch as the single-record endpoints, so a disabled capability
cannot be driven through the bulk route. The body is a strict discriminated schema:
ids must be cuids, **duplicates are rejected** rather than collapsed, the batch is
capped at 50 (20 for invitation re-issue), and only the value-bearing actions may
carry values.

**Server-side decisions, never client-supplied attributes.** The route accepts ids
and an action; every attribute (current skills, current areas, active state, linked
account) is re-read from the database. The client cannot name a technician field.

**Deactivation is refused while work is open.** If any selected technician has a
booking in `REQUESTED/CONFIRMED/TECHNICIAN_ASSIGNED/…/SERVICE_IN_PROGRESS`, the whole
batch is rejected with `409 ACTIVE_ASSIGNMENTS`, nothing is written, and the response
names the bookings. Deactivating a technician therefore can never strand a customer:
there is no silent deactivation and no invented reassignment workflow.

**Availability cannot be used to bypass activation.** `isAvailable` is only written
for ACTIVE profiles; deactivated technicians are skipped with a per-record reason.

**Concurrency.** Skill/area edits are read-merge-write with the previous value in the
`WHERE` clause, so a concurrent change is reported per record instead of being
overwritten. Status and availability writes are single conditional statements.

**Credentials.** Bulk invitation re-issue returns one-time activation paths **once**
in the response body (`Cache-Control: private, no-store`). They are never written to
the audit log, never logged, and never exported. Already-activated accounts are
skipped — this release has no reset, and the API says so.

**Export.** Only explicitly selected ids, capped, roster fields only. The projection
is fixed in the route (no `passwordHash`, `activationTokenHash` or session data), and
every CSV cell is quoted with formula triggers (`= + - @`, tab, CR) neutralised by a
leading apostrophe, so a spreadsheet cannot execute imported text.

**Audit.** Each batch writes exactly one `TECHNICIAN_BULK_CHANGED` event with the
actor, the operation, requested/affected/skipped counts, the affected ids and the
operator-entered values — no personal data beyond what the roster already holds.

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

### 1.4a Invoices - financial data handling

`src/lib/invoice.ts`, `src/lib/invoice-pdf.ts`, and the `/api/**/invoice*` routes.

**Nothing financial is accepted from the client.** The generation body schema is
`z.object({}).strict()`, so a request that tries to supply an amount, a price, a
tax rate, a status or a line item is rejected with `422` before any query runs. A
test asserts this. Every figure is read from the persisted booking.

**Eligibility is re-validated server-side, in one shared rule.**
`assessInvoiceEligibility()` refuses a booking that is not `COMPLETED`, that
already has an invoice, that has no seller, or that stores no confirmed amount.
The same function drives the button on the page, so the UI can never offer an
action the server would refuse - but the UI is never what enforces it.

**Duplicate and concurrent issuance.** The write runs in one transaction that
first claims the booking with a conditional `updateMany` on
`status = COMPLETED`; a second request updates zero rows and receives a `409`.
The database also enforces uniqueness on `Invoice.bookingId` and
`Invoice.number`, and a unique-constraint violation is mapped to an honest
`409 ALREADY_INVOICED`. A test drives two simultaneous requests and asserts one
`201`, one `409` and exactly one invoice.

**Numbering.** `SERIC-INV-<year>-NNNNNN`, allocated with an atomic
`upsert … increment` on the existing `Counter` table *inside* the invoice
transaction. There is no read-then-increment window, so simultaneous requests
cannot share a number even before the unique index is consulted.

**Arithmetic.** Integer paise only. Line totals are asserted to equal
`unitPrice × quantity` and the subtotal is asserted to equal the sum of the line
totals before persistence; a mismatch throws instead of writing a wrong document.
No tax is applied: `taxPaise` and `taxRateBps` are pinned to 0 because no verified
tax registration or rule is configured. Applying a default rate would fabricate a
legal liability, so the schema default was corrected from `1800` to `0`.

**Immutability.** Seller and customer details and the line items are snapshotted
at issue time (`sellerSnapshot`, `customerSnapshot`, and the line-item columns).
A later provider rename, address edit or catalogue price change cannot rewrite an
issued invoice, and the PDF is rendered from those snapshots rather than by
re-pricing. Verified against the real schema: a provider rename leaves both the
stored snapshot and the rendered PDF unchanged.

**Authorization.**

| Endpoint | Control |
| --- | --- |
| `POST /api/admin/bookings/[id]/invoice` | `assertSameOrigin → requireAdmin → assertCsrf → admin rate limit → invoice rate limit → strict Zod` |
| `GET /api/admin/invoices`, `/api/admin/invoices/[id]/pdf` | `adminReadGuard` + invoice rate limit |
| `GET /api/bookings/[id]/invoice/pdf` | `requireUser`, then a query scoped by `bookingId` **and** the session's `customerId` |

- A CUSTOMER cannot generate or alter an invoice: the generation route is
  admin-only (`403`).
- A customer id is never taken from the request, so IDOR is structurally
  impossible here; a foreign invoice is never loaded.
- A foreign invoice and a nonexistent one return **identical** `404` bodies, so
  the endpoint cannot be used to probe which ids exist.
- An administrator hitting the customer endpoint gets `404`, because authorisation
  is ownership-based and an administrator owns no booking - customer access is
  never widened by role.
- Invoice issuance and PDF rendering have their own tighter rate limit
  (`INVOICE_POLICY`, 30/minute/account).

**PDF safety.** The writer emits a PDF 1.4 file itself, with no library, no
headless browser and no network access. Every string is escaped for PDF
string-literal syntax (backslash, `(`, `)`) after control characters are stripped
and non-ASCII is replaced, so catalogue- or customer-supplied text cannot inject
content-stream operators; a test drives a hostile description and asserts the
escaped form. The file contains no server paths, hostnames, database ids or
internal notes. Responses are `no-store`, `nosniff`, and filename-sanitised.

**Auditability.** Issuance writes an `INVOICE_CREATED` audit event carrying the
invoice number, booking id and totals only - never customer contact data.

### 1.5 Payments

Milestone 4 replaced the draft webhook with a Razorpay integration whose
authoritative checks live on the server. Files: `src/lib/payments/**`,
`src/app/api/bookings/[id]/payment/**`, `src/app/api/webhooks/payment/route.ts`.

**Authority.** A payment is `CAPTURED` only after (a) the documented
`HMAC-SHA256(order_id|payment_id, key_secret)` checkout signature recomputes
correctly, **and** (b) a `GET /v1/payments/:id` fetch from the gateway reports
`captured` with the same order, amount and currency as the persisted invoice. A
browser callback alone changes nothing.

**Amounts.** The gateway order is created server-side for the invoice's integer
paise total; no amount, currency, invoice id or customer id is accepted from the
browser (`paymentInitiateSchema` is an empty `.strict()` object). The gateway's
echoed amount and currency are checked before use.

**Ownership.** Every invoice read in the payment flow includes `customerId` in the
query, so a foreign invoice is never loaded and answers the same `404` as a
missing one. A customer can never verify another customer's order.

**Webhook security (not CSRF).** A webhook is server-to-server with no session, so
CSRF and same-origin checks are meaningless and are deliberately absent. The
control is `X-Razorpay-Signature` = `HMAC-SHA256(raw_body, webhook_secret)`,
constant-time compared over the raw text read **before** parsing. An unsigned or
wrongly-signed delivery returns `400` and mutates nothing.

**Webhook idempotency.** `x-razorpay-event-id` is stored in a `@unique` column
(`PaymentWebhookEvent`): a retry returns `200 { duplicate: true }` without
touching a financial record. A delivery with no event id is refused. If
processing throws, the claim row is deleted and a `500` invites the retry, so a
transient failure is never mistaken for a duplicate.

**Forward-only state.** Every write is a conditional `updateMany` (status
allowlist). A late `payment.failed` cannot rewind a capture; a replayed capture
cannot pay an invoice twice; `gatewayOrderId` / `gatewayPaymentId` are unique, so
one gateway payment settles one record. Money writes and the invoice transition
share one transaction.

**No card data.** No PAN, CVV, UPI PIN or credential is received; the customer
enters those into the gateway's own checkout. The payment projection stores only
gateway ids, integer amounts, status, a safe failure code/description and refund
state.

**Refunds are read-only.** No refund endpoint exists, so no administrator (or
attacker with an admin session) can move money out. Refund state is mirrored from
signed `refund.*` webhooks and bounded by the captured amount.

**No administrative override.** Nothing in the admin console can mark a payment
successful, change an amount or edit a gateway reference - those endpoints do not
exist.

**Fails closed.** With credentials unset, both payment endpoints return `503
NOT_CONFIGURED` and the webhook refuses every delivery.

**Secrets.** `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are server-only
and never serialised: the initiation response carries the publishable key id, the
order id, the amount and the invoice number - nothing else. Errors from the
gateway keep only an HTTP status, never the response body (which can echo request
fields) and never the credentials.


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

451 tests across 30 suites (`npm test`). The security-relevant ones:

- **`tests/admin-invoices-page.test.ts`** - the invoice query schema is actually
  exported and has a working `safeParse`, invalid statuses / unknown parameters /
  unsafe pagination are rejected, array-valued parameters are normalised before
  validation, and the REAL `/admin/invoices` and `/admin/invoices/[id]` server
  components render (including their 401-redirect and non-admin not-found guards).
  This suite exists because an undefined schema reference in that page surfaced as
  a browser runtime error rather than a test failure.

- **`tests/invoice-ledger.test.ts`** - invoice eligibility for every booking
  status (including `CLOSED`/`CANCELLED` and a `CUSTOMER_BUDGET` booking with no
  confirmed amount), integer-paise arithmetic and the reconciliation guard, tax
  pinned to zero, snapshot reads that degrade safely, and PDF structure, escaping
  and figures.
- **`tests/invoice-api.test.ts`** - drives the real invoice routes: 401 for
  anonymous, 403 for a CUSTOMER, CSRF and Origin rejection, issuing from a
  `COMPLETED` booking from the persisted price only, refusal of ineligible and
  customer-budget bookings, repeated and **simultaneous** requests producing one
  invoice, sequential numbers, refusal of any financial field in the body, ledger
  search/paging validation, admin and customer PDFs, and a cross-customer `404`
  that is byte-identical to a nonexistent one.
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

The gateway integration itself is built (see 1.9). What remains is live
verification and operations:

11. **Verify against the Razorpay sandbox before taking real money.** With no
    credentials in this environment, no checkout and no webhook delivery has run
    against the real gateway. Register `{APP_URL}/api/webhooks/payment`
    (test mode), complete one successful and one failed test payment, and confirm
    the invoice moves only for the successful one.
12. Supply `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`
    from the secret manager. Rotate the webhook secret deliberately: while a
    rotation is in flight, use the old secret for retries of older events.
13. **Decide the refund policy** before enabling refunds (who, window, full vs
    partial, credit note). Until then the application only mirrors refund state.
13a. Confirm the gateway account's **payment capture** setting. If payments are
    left uncaptured they stay `AUTHORIZED`, which is reported honestly as
    "processing" rather than paid.
13b. Add alerting for: webhook deliveries that return non-2xx, payments stuck in
    `AUTHORIZED`, and events ignored as `unknown_payment` (a mismatch between the
    gateway account and this database).
13c. Whitelist Razorpay's published webhook IPs at the edge if your deployment
    requires it, in addition to signature verification.


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
17. **Technician credentials have no reset path.** A technician account is created
    with an unusable password plus a single-use activation link that the operator
    hands over out of band (there is no mail delivery). The link expires in 7 days
    and can be re-issued only while the account is still unactivated. Once a
    technician has set their own password, neither they nor an administrator can
    reset it. Decide the reset mechanism (emailed token, operator-assisted reset
    with audit, or directory integration) **before** enabling
    `portalEnabled` for real work.
18. **Choose how activation links are delivered.** They are one-time credentials.
    Today the operator copies the link from a dialog and sends it privately; there
    is no delivery history, no revocation list beyond the 7-day expiry, and no way
    to see whether a link was used except through the audit log. A production
    process (or a real mail channel) is required.
19. **Technician portal acceptance.** Confirm that the dispatch-minimal contact
    shown to a technician (the visit contact name and phone supplied by the
    customer) matches the business's privacy expectations, and that the absence of
    invoice and payment data in the portal is acceptable to operations.
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

### 6.7 Invoicing and tax

23. **Decide the tax position before issuing a real invoice.** No tax is
    calculated today, and that is a deliberate refusal to invent one: the
    provider record has no GSTIN and no tax rule is configured. If GST is
    applicable, record the verified registration (`Provider.gstin`) and implement
    a documented rate/basis rule in `calculateInvoiceTotals()`, then re-verify the
    PDF, which already renders a tax line whenever `taxPaise > 0`. Until then the
    invoice states plainly that no tax has been applied.
24. **Establish the invoice number series** against the applicable statute and
    retention period. The implementation is year-scoped and may contain gaps; if
    an unbroken consecutive series is required, replace `nextInvoiceNumber()`.
    Numbers are already unique at the database level and safe under concurrency.
25. **Define the correction policy.** An issued invoice is immutable and there is
    no void or credit-note flow. Decide the legally-required mechanism, implement
    it as an explicit auditable action (never an in-place edit) and record it in
    the audit log.
26. **Record a final agreed amount for `CUSTOMER_BUDGET` bookings** if they are to
    be invoiced. The domain currently stores only a range, so those bookings are
    refused rather than billed an invented figure.
27. **Invoice retention and backup.** Invoices, their snapshots and their PDFs are
    financial records: include them in the backup and retention policy, and never
    delete an issued invoice as part of routine data cleanup.
