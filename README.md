# MOYO

A service operations platform for booking, tracking and managing field services.

> ## MOYO = THE CUSTOMER-FACING SERVICE PROVIDER / SERVICE IDENTITY
>
> For the current deployment, **MOYO is the service identity customers interact
> with**. It is the name stored in `Provider.displayName` / `Provider.legalName`
> and the name rendered on every customer-facing provider surface: the provider
> card, the service pages, the booking wizard, the confirmation summary and the
> booking tracking screen.
>
> No other provider name is shown to customers. The `Provider` model still
> supports multiple providers - it is a general schema - but the current seeded
> deployment has exactly one, and it is MOYO.
>
> Contact details are the authoritative business contact for Moyo. They are
> stored on the `Provider` record and rendered into the Call and WhatsApp
> actions, both of which resolve to `+917047172454`.

---

## Current status

| Area | State |
| --- | --- |
| Customer booking wizard (steps 1-6) | **Implemented** |
| Booking tracking UI + reusable status component | **Implemented** |
| Customer booking list / current booking | **Implemented** |
| Customer booking history | **Partially implemented** - list with status filters and paging; no date-range or export view |
| Technician assignment UI (customer side) | **Implemented** - shows real details only once assigned |
| Technician dispatch UI (operator side) | **Not yet implemented** |
| Invoicing, payment capture, feedback capture | **Not yet implemented** (schema and state machine exist; no customer UI) |
| Material ordering / cart | **Not yet implemented** |
| Support messaging | **Not yet implemented** |
| Account profile, password reset, email verification | **Not yet implemented** |
| **Admin authorization (server-enforced RBAC)** | **Implemented** |
| **Admin dashboard (live database metrics)** | **Implemented** |
| **Admin category management** | **Implemented** - read-only catalogue identity + activation |
| **Admin service management** | **Implemented** - search, filter, paging, detail, activation |
| **Admin charging-option management** | **Implemented** |
| **Admin published-pricing management** | **Implemented** |
| **Admin bookings list** | **Implemented** - search by reference, status filter, server-side pagination; read-only |
| Admin bookings / dispatch / technicians / customers | **Partially implemented** - bookings list is live; confirm/assign/state transitions shown as disabled "Soon" |
| Admin invoices / payments / reviews / audit log / settings | **Not yet implemented** - shown as disabled "Soon" |
| Payment provider integration | **Requires production configuration** |
| Deployment hardening (Redis rate limiting, PostgreSQL, native enums) | **Requires production configuration** - see [SECURITY.md](./SECURITY.md) §6 |

---

## What was here before

The repository previously contained a single 2,948-line static HTML file using
the Tailwind CDN and Font Awesome CDN, with client-side-only "routing", no
backend, no database, no authentication and no input validation. It contained a
reflected DOM XSS (a search dropdown interpolating a raw query string into
`innerHTML`) and presented fabricated operational claims - a named "available"
technician, arrival ETAs, "60-Min Instant Dispatch", "100% Genuine OEM Warranty",
"Verified Technicians", 4.7-4.9 ratings and a hard-coded visit fee.

That file is preserved verbatim at `legacy/index.html` for reference and is
excluded from lint, typecheck and the build.

**None of those fabricated claims survive into the new application.** Where a
price, rating, availability or ETA is not present in the database, the interface
says so plainly.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` |
| Database | Prisma ORM (SQLite for development, PostgreSQL for production) |
| Auth | Opaque database-backed sessions, bcrypt (cost 12), server-side RBAC |
| Validation | Zod, `.strict()` on request bodies |
| Styling | Tailwind CSS v4 (CSS-first `@theme`) |
| Tests | Vitest |
| Lint | ESLint 9 flat config |

**No third-party JavaScript or CSS runs on any page.** Icons are inline SVG and
fonts are self-hosted, which removes the CDN supply-chain risk and keeps the
Content-Security-Policy strict.

---

## Getting started

```bash
npm install

# Generates .env with a fresh random SESSION_SECRET (never overwrite an existing one)
node scripts/setup-env.mjs

# Create the database, generate the client, seed the catalog and the provider
npm run setup

npm run dev
```

The seed loads all **20 official categories** (98 services) exactly as specified
in `prisma/catalog.ts`, and registers MOYO as the service provider using only
the business details actually supplied.

### Creating an admin account

There is **no hard-coded admin password**. To bootstrap the first administrator,
set these in `.env`, run `npm run db:seed`, then remove them:

```bash
SEED_ADMIN_EMAIL="admin@example.com"
SEED_ADMIN_PASSWORD="a-strong-password-of-at-least-12-chars"
```

### Before the booking flow can be completed

The seed creates all three charging options per service as **inactive and
unpriced**. This is deliberate: a price is a commercial decision, and inventing
one would misrepresent the business. Until an administrator publishes pricing,
the wizard reaches step 3 and honestly reports that no charging option is
available, and the tracking screens say the price is not published.

---

## The admin console

`/admin` is a real operations console backed by the same server-side domain model
as the customer site. It is not a visual mockup and it runs on no mock data.

### Admin routes

| Route | What it does |
| --- | --- |
| `/admin` | Dashboard - live aggregates from the database |
| `/admin/categories` | The 20 official categories, read from the database |
| `/admin/services` | Service table: search, filters, pagination |
| `/admin/services/[id]` | Service detail, charging configuration, published pricing |
| `/admin/charging-options` | Which options MOYO offers, and Customer Budget ranges |
| `/admin/pricing` | Publish / withdraw published prices |
| `/admin/bookings` | Every booking, newest first: reference search, status filter, pagination (read-only) |

Modules that are **not yet built** (Dispatch actions, Technicians, Customers,
Materials, Invoices, Payments, Reviews, Audit log, Settings) appear in the
sidebar as **disabled entries marked "Soon"**. They are deliberately not links:
a navigation item that leads to a 404 advertises a capability the console does
not have. No planned module is dressed up with fake functionality, sample rows or
placeholder metrics.

### Admin API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/admin/categories` | Category list with live service counts |
| `PATCH /api/admin/categories/[id]` | Activate / deactivate a category |
| `GET /api/admin/services` | Service table (search, filter, page) |
| `GET /api/admin/services/[id]` | Service detail + count of existing quoted bookings |
| `PATCH /api/admin/services/[id]` | Activate / deactivate a service |
| `GET /api/admin/charging-options` | Every `ServiceOption` with its service context |
| `PATCH /api/admin/charging-options/[id]` | Availability, budget bounds, duration |
| `GET /api/admin/pricing` | Pricing table (filter by state, category, option) |
| `PATCH /api/admin/pricing/[id]` | Publish or withdraw a published price |
| `GET /api/admin/bookings` | Booking list: `q` (reference substring), `status` (allowlisted canonical status or `ALL`), bounded `page` / `pageSize` |

### Admin authorization

Authorization is enforced **on the server at every boundary**. Hiding a link in
React is never the control, and there is no client-side role check anywhere.

| Situation | Result |
| --- | --- |
| No session, admin page | `redirect` to `/login?next=/admin` (validated relative path, never an absolute URL) |
| No session, admin API | `401 UNAUTHENTICATED` |
| CUSTOMER / PROVIDER / TECHNICIAN, admin page | Explicit access-denied screen with no admin chrome and no database content |
| CUSTOMER / PROVIDER / TECHNICIAN, admin API | `403 FORBIDDEN` - no data, no write, no audit event |
| ADMIN | Allowed |

There are three independent layers, and removing any one does not remove the
protection:

1. **`src/proxy.ts`** - redirects a request that has no session cookie. It runs
   in the Edge runtime with **no database access**; it only checks that a cookie
   is *present*, so it is a UX optimisation, not a security control.
2. **`src/app/admin/layout.tsx`** - resolves the session and refuses non-admins
   before any page content or query runs.
3. **Per page and per route** - every admin page calls `requireAdminPage()`, and
   every admin API calls `adminReadGuard()` / `adminWriteGuard()`. This is the
   layer the automated tests exercise.

The role is read from the **database on every request** via `getCurrentUser`,
which re-validates the stored role with `isRole()` before it is used for any
decision. Sessions are opaque and database-backed, so a logout or a role change
takes effect on the very next request - there is no token that could carry a
stale claim.

### Roles

`CUSTOMER`, `PROVIDER`, `TECHNICIAN`, `ADMIN`. Only `ADMIN` may reach `/admin`
or `/api/admin/**`. `PROVIDER` and `TECHNICIAN` are scoped owners elsewhere in
the booking model, but are **not** administrators.

### Admin bookings list

`/admin/bookings` is the dispatch queue's read side: every booking in the
database, newest first, with a reference search box, a status filter and
server-side pagination. The page and `GET /api/admin/bookings` share one
`.strict()` query schema (`adminBookingQuerySchema` in `src/lib/validation.ts`):
only `q`, `status`, `page` and `pageSize` are accepted, an unknown parameter or
a free-form status is rejected (422 on the API, safe defaults on the page), and
`status` reaches the query only as an allowlisted canonical `BOOKING_STATUSES`
value (`ALL` means no constraint).

Authorization is the standard read chain (`adminReadGuard` on the API,
`requireAdminPage` on the page): 401 with no session, 403 for any non-ADMIN
role. The row projection (`listAllBookings` in `src/lib/customer-bookings.ts`)
is explicit - customer name and service location only, never phone, email or
street address. The screen is read-only: confirming a booking, assigning a
technician and advancing booking state are not built yet, and no control on the
page pretends otherwise.

### Mutations

Every admin mutation runs this chain, in this order, **before the request body
is parsed**:

```
assertSameOrigin -> requireAdmin -> assertCsrf -> rate limit
                  -> Zod .strict() parse -> catalog write model
```

Authorization is therefore checked before application logic runs, let alone
before any write. A non-admin request is rejected as `UNAUTHENTICATED` /
`FORBIDDEN` without leaking whether its CSRF token was also wrong.

Each mutation has a confirmation dialog, disables its button while in flight,
reports the server's message verbatim as text on failure, and never updates
optimistically - the table re-renders from the database.

### What is editable, and what is not

Only two things are commercially editable, and each is the server's decision:

| Field | Editable | Notes |
| --- | --- | --- |
| `Category.name`, `.code`, `.position` | **No** | Authoritative official catalogue identity. Absent from the mutation schema, so they cannot be mass-assigned. |
| `Service.name`, `.slug`, `.serviceType`, placement | **No** | Same: absent from every mutation schema. |
| `Category.isActive`, `Service.isActive` | Yes | Deactivation hides a record from customers; nothing is deleted and all booking history is kept. |
| `ServiceOption.isActive` | Yes | Availability of a charging option. |
| `ServiceOption.budgetMin/MaxPaise` | Yes | **Customer Budget only.** Rejected server-side on the other two options. |
| `ServiceOption.pricePaise` | Yes, **only** via `PATCH /api/admin/pricing/[id]` | Deliberately absent from the charging-options schema, so enabling an option can never expose a price. |

Because every schema is `.strict()`, an unexpected key **rejects the whole
request** rather than being ignored. Ignoring it would leave a caller believing a
change had been made when it had not.

### Pricing rules

- **Server-authoritative.** The browser never supplies an amount.
  `resolveBookingPricing()` (`src/lib/pricing.ts`) is the single source of truth
  and takes **no price parameter at all**. `quoteSchema` and `createBookingSchema`
  are `.strict()` and have no price field, so posting one is rejected outright.
- **Unpublished is the default.** The seed creates every `ServiceOption` as
  inactive with `pricePaise = null`. No sample price is seeded to make the
  console look populated. Until a price is published, the customer service page
  shows its neutral **"On request"** state and the wizard reports that no
  charging option is available.
- **Historical quotes are immutable.** A booking stores the price it was quoted
  at creation (`quotedPaise`, `budgetMinPaise`, `budgetMaxPaise`). A price
  mutation writes **only** to `ServiceOption`; the pricing code path never reads
  or writes a `Booking` row. Re-pricing the catalogue cannot retroactively change
  an agreed quote. The service detail screen shows how many existing bookings
  hold a quote, so the consequence is visible before the change is made.
- **Publish guards.** A price cannot be published for a disabled option or a
  deactivated service, so a customer is never shown a price for something the
  booking domain would reject as unavailable.
- **Customer Budget carries no fixed price.** In that mode the customer states a
  budget and the provider confirms scope, so `resolveBookingPricing` always
  returns `quotedPaise: null`. Publishing a figure there is rejected
  (`PRICE_NOT_APPLICABLE`), because it would advertise a number that can never be
  quoted.

### The three official charging concepts

Preserved exactly as the domain model defines them in `src/lib/domain.ts`:
**Visit Charge**, **Fixed Charge**, **Customer Budget**. They are read back from
the seeded `ServiceOption` rows rather than restated as a new set. Customer Budget
keeps its existing min/max/range semantics: both bounds are required, must sit
inside the published range, and the server clamps them to the platform floor and
ceiling.

### Audit logging

Commercial and catalogue mutations write to the existing `AuditLog` model through
`src/lib/audit.ts`. Five actions were added for this milestone:

| Action | Recorded when |
| --- | --- |
| `CATEGORY_STATUS_CHANGED` | A category is activated or deactivated |
| `SERVICE_STATUS_CHANGED` | A service is activated or deactivated |
| `CHARGING_OPTION_CHANGED` | Availability, budget bounds or duration change |
| `PRICE_PUBLISHED` | A price becomes visible to customers |
| `PRICE_UNPUBLISHED` | A price is withdrawn |

Publication and withdrawal are deliberately **distinct** actions rather than one
generic "price updated": they are different events with different risk, and
collapsing them would make the log useless for reconstructing who changed what.
Each row records the previous and the new value, plus
`historicalBookingsUnchanged` for price events, so a disputed quote can be
reconstructed. No secrets, passwords, session tokens or personal data are ever
written.

### Operator identity and the provider contact email

`dharmendra.kori@outlook.com` is **both** the provider's published contact
address and the login address of an existing **CUSTOMER** account. These are
different things, and the architecture keeps them separate:

- `Provider.contactEmail` is a **display field**, rendered into the customer
  site's contact details and never used to authenticate anyone.
- `User.email` is the **login** address, and it is `@unique`.
- `User.role = 'ADMIN'` is **orthogonal to both**. `requireAdmin()` resolves
  authorization from the session's role only; it never compares an email against
  the provider record.

The consequence: **an operator login does not need the provider contact email.**
An administrator is created with whatever free address is configured in
`SEED_ADMIN_EMAIL`, and nothing about the existing customer account has to
change. That account is therefore left exactly as it is - not deleted, not
converted to ADMIN, and its login is not broken. `prisma/seed.ts` also refuses to
take the contact address from it, and now reports the address the provider
account actually retained, so the operator can see which login to use.

**No admin account exists in the current development database** (`admins: 0`),
because `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are intentionally blank in
`.env`. Set them once, run `npm run db:seed`, then remove them. There is no
default password anywhere in this repository.

### The 20 categories

The category list is read from the database at request time via
`listAdminCategories()`. There is **no client-side copy** of the 20 categories
anywhere in the admin console: a duplicated constant would drift and could show
a category the catalogue does not contain. The seed in `prisma/catalog.ts`
remains the only place the official list is defined.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite |
| `npm run setup` | Generate client, push schema, seed |
| `npm run db:reset` | Drop, recreate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run audit:prod` | Runtime dependency audit |

---

## The customer booking flow

```
Home → Category → Service → Charging option → Booking details
     → Confirmation → Booking created → [tracking] → Technician assignment
     → Technician visit → Job tracking → Job done → Invoice → Payment → Feedback
```

The first six stages are the customer booking wizard. The stages after
"Booking created" are the tracking lifecycle, which advances only when an
operator (or the payment webhook) moves the booking forward. **The UI never
advances a stage by itself.**

### Wizard steps

| Step | Screen | Rendered | Notes |
| --- | --- | --- | --- |
| 1 | Category | Server | The 20 official categories, via `listCategories()` |
| 2 | Service | Server | Services within the chosen category, via `getCategoryBySlug()` |
| 3 | Charging option | Server shell + client | The three official charging options, via `getServiceChargingOptions()` |
| 4 | Booking details | Client | Mode, purpose, address, contact, description, budget |
| 5 | Confirmation | Client | Full summary + **server-resolved** price + explicit confirmation checkbox |
| 6 | Booking created | Client | Booking reference, status, provider, next action |

Steps 1-3 are server-rendered so the catalog is never duplicated into a
client-side constant; the browser receives only the rows it needs. The URL
carries the selection (`/book?category=…&service=…&charging=…`), so every step
is linkable and back/forward work.

### Charging options

| Option | Label | Behaviour |
| --- | --- | --- |
| `VISIT_CHARGE` | Visit Charge | A visit/inspection charge applies; the final work cost is confirmed after inspection |
| `FIXED_CHARGE` | Fixed Charge | A published fixed price applies for the stated scope |
| `CUSTOMER_BUDGET` | Customer Budget | The customer supplies a minimum and maximum budget; the provider confirms what can be delivered within it |

### Pricing rules

1. **A client chooses WHICH option applies. It never chooses what it costs.**
   `resolveBookingPricing()` (`src/lib/pricing.ts`) is the only pricing authority.
2. `quotedPaise`, `customerId`, `providerId` and `status` are resolved or fixed on
   the server. The request schema is `.strict()`, so sending them is a **422**,
   not a silently ignored field.
3. The figure on the confirmation screen comes from `POST /api/bookings/quote`,
   which calls the same function the create route uses. The create route resolves
   the price **again**, so a tampered confirmation screen cannot change what is
   stored.
4. A published price is labelled **"Published service price (estimate)"** and is
   always accompanied by text distinguishing it from the final invoice. An
   unpublished price renders as **"Not published"** - never `₹0`, never a guess.
5. A budget booking never records a fixed quote (`quotedPaise` stays `NULL`),
   because the provider has not yet priced the work.

### Booking state model

```
REQUESTED → CONFIRMED → TECHNICIAN_ASSIGNED → TECHNICIAN_ON_THE_WAY
→ ARRIVED → SERVICE_IN_PROGRESS → COMPLETED → INVOICE_GENERATED
→ PAYMENT_PENDING → PAID → FEEDBACK_PENDING → CLOSED
                                                          ↘ CANCELLED
```

Transitions are validated server-side against `src/lib/booking-state.ts`. Roles
are keyed **per transition edge**, so a technician may mark work complete but may
not issue an invoice, and **no role at all** may set `PAID` - that edge is
reachable only through the signature-verified payment webhook.

The tracking UI derives its stages from this same list. Stages before the current
status are `complete`, the current one is `current`, and **every later stage stays
`pending`**. A cancelled booking shows a dedicated cancelled state rather than a
progress bar that would imply forward progress.

### Authentication and authorization

- Booking requires an authenticated session. The wizard is browsable signed-out,
  but the create route returns **401** without a session.
- `customerId` is taken from the session, never from the request.
- Ownership is enforced **inside the query**. `getCustomerBooking()` and
  `listCustomerBookings()` take the acting customer's id from the session and
  filter on it in SQL, so another customer's record is never loaded into memory.
- **Not-found and not-yours are indistinguishable** - both render the same 404
  page and return the same body, so the endpoints cannot be used to discover which
  booking ids exist.
- CSRF (double-submit token + origin check) is required on every mutation,
  including the quote preview.

---

---

## Routes and pages

| Route | Auth | Purpose |
| --- | --- | --- |
| `/` | Public | Homepage |
| `/categories` | Public | All 20 official categories |
| `/categories/[slug]` | Public | Services in a category |
| `/services/[slug]` | Public | Service detail, published pricing, provider |
| **`/book`** | Browse public, sign-in to submit | **Booking wizard, steps 1-6** |
| **`/bookings`** | Required | Customer's own bookings (current, filters, paging) |
| **`/bookings/[id]`** | Required + ownership | **Booking tracking for one booking** |
| **`/account`** | Required (every role, incl. ADMIN) | **Personal account: profile, address editing, password change, recent activity** |
| `/login`, `/register` | Public | Authentication |
| `/admin` | `ADMIN` | Admin console |
| `/privacy`, `/terms` | Public | **Not yet implemented** (linked in the footer) |

Mobile navigation: `Home · Menu · Booking · Bookings · Account`.

### Post-login and registration redirect rules

The `next` query parameter is attacker-controlled and the user's role is always
resolved server-side from the database session. `resolvePostLoginRedirect(next, role)`
in `src/lib/redirect.ts` is the single authority for both login and registration
destinations:

- **Login, no explicit `next`:** **both** `ADMIN` and `CUSTOMER` land on the public
  homepage `/`. Neither `/account` nor `/admin` is ever an automatic destination.
- **Login, valid `next`:** honoured only when it is a safe local path **and** the
  role may use it. `?next=/account` works for every role; `?next=/admin` is honoured
  only for `ADMIN` and falls back to `/` for everyone else.
- **Registration:** succeeds **without** creating a session. The browser is sent to
  `/login?registered=1` (a non-sensitive flag drives the success message — never a
  credential). If a safe `next` was requested it is preserved through that hop and
  applied only after a real, role-authorized login.
- **Unsafe `next`** (external, `//host`, backslash, control chars, or any
  credential-bearing query) always falls back to the homepage `/`.

Credentials travel only in the POST body; the `next` path rides on the API URL and
is re-validated with `safeRedirectPath()` server-side, so it can never become an
open redirect or leak a secret.

### Account navigation

The **Account** entry in the shared customer shell (desktop header avatar/name and
the mobile bottom bar) always points at the personal `/account` page for a signed-in
user of **any** role, including `ADMIN`, and at `/login?next=%2Faccount` for
anonymous visitors.
Anonymous clicks therefore land on `/login?next=%2Faccount` and return to `/account`
after a successful login. The personal Account page is deliberately separate from the
Admin Console: `/admin` remains reachable only through its own ADMIN-only link and its
server-side guards.

---

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create a customer account |
| `POST` | `/api/auth/login` | Public | Start a session |
| `POST` | `/api/auth/logout` | Session | Revoke the session |
| `GET` | `/api/auth/csrf` | Public | Issue a CSRF token |
| `GET` | `/api/account/profile` | Session | Read own minimal profile (no secrets) |
| `PATCH` | `/api/account/profile` | Session + CSRF | Update own name/phone (strict schema) |
| `PUT` | `/api/account/address` | Session + CSRF | Create/update own saved address |
| `POST` | `/api/account/password` | Session + CSRF | Change password, revoke all sessions |
| `POST` | `/api/bookings` | Session | **Create a booking** (server-resolved pricing) |
| **`GET`** | **`/api/bookings`** | Session | **List the caller's own bookings** |
| **`GET`** | **`/api/bookings/[id]`** | Session + ownership | **Read one booking** |
| **`POST`** | **`/api/bookings/quote`** | Session + CSRF | **Server-side price preview (persists nothing)** |
| **`GET`** | **`/api/bookings/[id]/attachments`** | Session + ownership | List attachment metadata |
| **`POST`** | **`/api/bookings/[id]/attachments`** | Session + CSRF | Upload one validated image |
| `POST` | `/api/bookings/[id]/transition` | Session + role | Advance a booking's state |
| `POST` | `/api/webhooks/payment` | Signature | Mark a booking `PAID` |

Errors always return `{ error: { code, message, fields? } }`. Stack traces, SQL
errors and Prisma messages are never serialised to the client.

---

## Architecture

```
src/
├── app/
│   ├── (customer)/          Customer routes: /, /categories, /services, /book, /bookings, /account
│   ├── admin/               Admin console: /admin
│   └── api/                 Route handlers (auth, bookings, webhooks)
├── components/
│   ├── customer/            Shell, Cards, BookingWizard, BookingStatus, AuthForms
│   ├── admin/               Admin shell and tables
│   └── ui/                  Design-system primitives
├── lib/
│   ├── auth.ts              Sessions, RBAC guards, CSRF
│   ├── access.ts            IDOR-safe ownership scoping
│   ├── booking-state.ts     State machine (single source of truth)
│   ├── booking-tracking.ts  Tracking view model (pure, unit tested)
│   ├── pricing.ts           Server-side price resolution
│   ├── customer-bookings.ts Ownership-scoped customer reads
│   ├── queries.ts           Catalog read models
│   ├── validation.ts        Zod schemas
│   ├── uploads.ts           Upload validation
│   ├── audit.ts             Audit logging
│   ├── rate-limit.ts        Rate limiting
│   ├── crypto.ts            bcrypt, tokens, hashing
│   ├── env.ts               Fail-fast environment validation
│   └── domain.ts            Canonical constants (see note below)
├── proxy.ts                 Edge security headers + auth redirects
prisma/
├── schema.prisma            Data model
├── catalog.ts               The 20 official categories
└── seed.ts                  Idempotent seeding
tests/
├── booking-state.test.ts    State machine invariants
├── booking-tracking.test.ts Tracking view model
├── booking-api.test.ts      Real route handlers (auth, CSRF, IDOR, pricing)
├── provider-identity.test.ts Provider identity, contacts and link targets
├── security.test.ts         Redirect and narrowing defences
├── validation.test.ts       Input validation and mass-assignment
└── stubs/                   Test-only shims for `server-only` and `next/headers`
```

### Testing approach

The suites run without a database. Several drive the **real route handlers**,
mocking only Prisma, `next/headers` and `server-only`, so the genuine guard chain
executes end to end.

| Suite | Tests | What it drives |
| --- | --- | --- |
| `booking-state.test.ts` | 15 | The booking state machine, including that no role may mark a booking paid |
| `security.test.ts` | 10 | Open-redirect prevention and role/status narrowing |
| `booking-tracking.test.ts` | 15 | Customer-facing status rendering |
| `provider-identity.test.ts` | 14 | MOYO identity and contact values, and that retired values are absent from source |
| `validation.test.ts` | 21 | Request schemas |
| `booking-api.test.ts` | 23 | Real `/api/bookings*` routes: `requireUser → assertCsrf → rate limit → Zod → domain` |
| **`admin-auth.test.ts`** | **16** | **Real `/api/admin/*` routes: 401, 403 for CUSTOMER, ADMIN access, CSRF, Origin, malformed ids** |
| **`admin-pricing.test.ts`** | **16** | **Price publish/withdraw, strict validation, mass-assignment refusal, budget rules, audit actions, historical-quote immutability** |
| **`pricing-visibility.test.ts`** | **10** | **Published vs unpublished prices, and that the customer cannot influence the quote** |
| `auth-url-security.test.ts` | 11 | Credential-free auth URLs, `next` scrubbing on `/login`/`/register` |
| **`account.test.ts`** | **16** | **Real `/api/account/*` routes: self-only isolation, mass-assignment refusal, password change + session revocation** |
| **`post-login-redirect.test.ts`** | **7** | **Homepage-first defaults, role-aware `next`, `/admin` guard, unsafe-destination fallback** |
| **`registration-flow.test.ts`** | **6** | **Real `/api/auth/register`: no session minted, `registered` flag, `next` hop, no privilege escalation** |
| **`navigation.test.ts`** | **7** | **Shared customer shell: Account nav is `/account` for every signed-in role, `/login?next=%2Faccount` anonymous, never `/admin`; shell wiring for the `(customer)` route group** |
| **`admin-bookings.test.ts`** | **12** | **Real `GET /api/admin/bookings`: 401/403, strict query rejects, allowlisted status filter, reference search, bounded pagination, nav live** |
| **Total (suites listed here)** | **199** | **The table above predates several suites; the runner reports 268 tests across 20 files (see changelog)** |

The admin suites assert the properties that must not regress: a CUSTOMER gets
`403` on every admin endpoint and writes nothing, an unauthenticated caller gets
`401`, an ADMIN succeeds, a missing or guessed CSRF token fails even for an
ADMIN, a cross-origin mutation is refused, an unexpected key rejects the whole
request rather than being ignored, each mutation records the correct audit action,
and a price change leaves existing booking quotes untouched.

Two test-harness details are deliberate: the mock's `serviceOption.findUnique`
returns a **copy** so an update cannot retroactively mutate the "previous value"
snapshot the audit trail records, and the mock's `booking` model **throws on any
write**, so a future refactor that started rewriting bookings would fail loudly
rather than quietly change historical prices.

### Note on "enums"

The development datasource is SQLite, which Prisma cannot create native enums
for. Every enum-like column is therefore a `String` whose allowed values live in
`src/lib/domain.ts`, enforced by Zod at the API boundary and re-validated before
every write. **On PostgreSQL these should be promoted to native enums** for
database-level enforcement - see `SECURITY.md` §6.3.

---

## Security

Read **[SECURITY.md](./SECURITY.md)** before deploying.

It documents what is implemented, what was verified, and - importantly - **what
remains outstanding**. This project makes no claim of being vulnerability-free.
Security is a property of a deployed system, not of source code.

Current state (verified for the customer booking wizard + tracking milestone):

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 errors, 0 warnings) |
| `npm test` | PASS (140 tests, 9 suites) |
| `npm run build` | PASS (no warnings) |
| `npm run audit:prod` | 0 vulnerabilities |
| `npm run db:seed` | PASS (idempotent) |

### Security regression check for this milestone

This milestone was reviewed against the following. **No claim of being
vulnerability-free is made** - see `SECURITY.md` for what is still outstanding.

| Risk | How it is handled here |
| --- | --- |
| Client-trusted pricing | `quoteSchema` and `createBookingSchema` are `.strict()` with no price field; the price is re-resolved server-side on both the preview and the create |
| IDOR | Ownership is part of the SQL `where` clause; "not yours" and "not found" return identical 404s (asserted by test) |
| Privilege escalation | `customerId`, `providerId`, `role` and `status` are never accepted from the request |
| CSRF bypass | Double-submit token **and** origin check on every mutation, including the new quote and attachment routes |
| XSS | React escaping only; no `dangerouslySetInnerHTML`; ESLint `react/no-danger` is an error |
| Open redirect | The sign-in `next` value is built from known values and validated by `safeRedirectPath()` |
| Sensitive data exposure | Narrow projections; the booking list omits phone and full address; attachments return no filesystem path |
| Stack traces in responses | `apiHandler` returns a generic 500 and logs detail server-side only |
| Unsafe file handling | `uploads.ts` verifies MIME, extension, **magic bytes** and path containment; the filename is server-generated |
| ORM injection | All queries go through Prisma's parameterised API; the only dynamic value is an allowlisted status |
| CDN / external scripts | None. Inline SVG icons, self-hosted fonts, strict CSP |

### New in this milestone

| Control | Detail |
| --- | --- |
| `READ_POLICY`, `QUOTE_POLICY` | 120/min reads and 30/min quotes, per authenticated user |
| `ATTACHMENT_UPLOADED` audit action | Uploads are recorded without storing user-supplied paths |
| Attachment status gate | Uploads are refused once work has begun (`SERVICE_IN_PROGRESS` and later) |
| Tracking view model | `projectLifecycle()` cannot report a future stage as complete - asserted by test |
| Provider identity pinning | `provider-identity.test.ts` asserts the seeded identity and contacts, the generated Call and WhatsApp targets, and scans every active source file for retired values |

---

## Data honesty rules

These are enforced in code and partly by tests:

1. Prices come **only** from `ServiceOption` rows. The client selects which
   charging option applies; the server decides what it costs.
2. A published price is always labelled an **estimate**, never the final
   invoice, and an unpublished price renders as "Not published" - never `₹0`.
3. Ratings aggregate **approved** reviews only. With zero reviews the UI shows an
   explicit empty state, never `0 stars`.
4. Technician details appear **only after** a technician is assigned. Until then
   the UI says "Technician details will appear after assignment." No fabricated
   names, credentials, availability or arrival times.
5. Booking status hints and lifecycle stages never contain an ETA, a guarantee or
   a "100%" claim - asserted by a unit test that scans every string.
6. A future lifecycle stage is always rendered as **Pending**, never as reached.
7. A booking becomes `PAID` **only** via a signature-verified payment webhook. No
   user role can do it, including `ADMIN`.
8. Provider fields that would require verification (GSTIN, certifications) are
   `NULL` in the seed and render as neutral copy.

---

## Service catalog

The 20 official categories are defined in `prisma/catalog.ts` and seeded into the
database. They are **data, not markup** - there is no per-category HTML file, and
the wizard reads them from the database rather than from a client-side constant.
Renaming or reordering them is a data change.

---

## Known limitations

1. **No pricing is published by default.** The seed leaves every charging option
   inactive and unpriced, so a fresh install cannot complete a booking until an
   administrator publishes prices. This is intentional, not a defect. Real prices
   are a commercial decision and have not been invented.
2. **Technician records are not seeded.** The platform does not know a technician's
   real availability, so none are invented. The tracking UI is built for them and
   shows the honest placeholder until one is assigned.
3. **Rate limiting is per-process.** See `SECURITY.md` §5.
4. **Most admin modules are not built.** The console covers the dashboard,
   catalogue, charging options, pricing, and the read-only bookings list.
   Booking confirmation, technician assignment, state transitions, technicians,
   customers, materials, invoices, payments, reviews, the audit-log viewer and
   settings are shown as disabled "Soon" entries. They have no screens and no
   fake behaviour. The audit events *are* written to the database for every
   mutation this milestone introduces - only the screen to browse them is missing.
5. **Invoice, payment and feedback have no customer UI.** The schema, state
   machine and webhook exist; the screens do not.
6. **`/privacy` and `/terms` are linked in the footer but not implemented.**
7. **No admin account exists in the development database** (`admins: 0`) because
   `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are blank in `.env`. Set them once,
   run `npm run db:seed`, then remove them. There is no default password in the
   repository.
8. **The provider operator account still holds a retired login address.** It is
   not used for authentication by the console (see
   *Operator identity and the provider contact email* above) and was deliberately
   not changed, because rewriting a live account's login address is an identity
   decision, not a cosmetic one. Rotate it deliberately before launch.
9. SQLite and string-backed "enums" are development-only - see `SECURITY.md` §6.3.

---

## Roadmap

**Next milestone (dispatch)** - Technician dispatch console: confirm a booking, assign a technician, advance
  the on-site states. The `/admin/bookings` list (this milestone) is the read
  side it will act on.
- Audit-log viewer over the events the catalogue milestones write
- Customer invoice view and payment initiation
- Customer cancellation flow

**Later**
- Technician roster and customer management screens
- Review moderation (schema and `FEEDBACK_PENDING` state already exist)
- Material ordering / cart (schema already present)
- Support messaging (schema already present)
- Account profile, password reset, email verification
- Notifications over real channels (currently in-app only)

---

## Service provider identity and contact

MOYO is the customer-facing service identity for the current deployment. The
values below live on the `Provider` record and are rendered by
`getPrimaryProvider()` into every customer-facing provider surface.

| Field | Value |
| --- | --- |
| Display name (customer-facing) | **MOYO** |
| Legal name | **MOYO** |
| Slug | `moyo` |
| Registered address | Top Floor, Multicare Hospital, Royal Market, Bhopal, Madhya Pradesh 462030 |
| Email | `dharmendra.kori@outlook.com` |
| Phone / Call | `+917047172454` (`tel:+917047172454`) |
| WhatsApp | `+917047172454` (`https://wa.me/917047172454`) |

Call and WhatsApp deliberately use the **same number**. `Provider.contactPhone`
and `Provider.whatsappNumber` are both stored as `917047172454` - the digits
include the country code, because `telLink()` and `whatsappLink()` in
`src/lib/format.ts` normalise to digits and emit the international form.

### Renaming the provider without breaking relationships

`Provider.slug` is `@unique` and is not referenced anywhere else in the
application, so renaming it is safe - **but only if the existing row is migrated
in place**. Upserting on a new slug alone would create a *second* provider,
orphaning the original's `ProviderService` links and every `Booking.providerId`
foreign key that points at it.

`prisma/seed.ts` therefore keeps an explicit `LEGACY_PROVIDER_SLUGS` allowlist
and runs `migrateLegacyProviderSlug()` before the upsert, which moves the row and
preserves its id. Re-seeding is idempotent: a second run changes nothing.

### A note on the operator login account

The seed owns a `PROVIDER`-role `User` that owns the provider profile. Its
display name and phone are kept in step with the provider identity. Its **email
is only updated when the authoritative address is genuinely free** - `User.email`
is `@unique`, and taking the address from another account would break that
account's login. The customer-facing contact details live on the `Provider`
record and are always correct regardless.

---

## Rollback

The pre-refactor state is preserved on the `backup/pre-moyo-refactor` branch.

```bash
git checkout backup/pre-moyo-refactor
```

The refactor work is on `feature/moyo-platform`. `main` was never modified.

---

## Changelog - Admin shell sidebar layout fix

**Scope:** layout/CSS only in `src/components/admin/Chrome.tsx`. No change to
business logic, Prisma schema, seed data, authentication, RBAC, APIs, pricing
logic, booking logic, or the customer UI.

- **Root cause:** the desktop sidebar was `position: fixed` (`fixed inset-y-0
  left-0`) while the header and `main` content relied on a compensating
  `lg:ml-64` offset instead of occupying structural layout space, so dashboard
  content rendered underneath the sidebar whenever the offset drifted.
- **Fix:** the admin shell is now a structural flex column - the header spans
  the full width on top, and below it a `flex flex-1` row holds the sidebar as
  a real `w-64 shrink-0` column next to a `min-w-0 flex-1` main column. The
  desktop sidebar is `position: sticky` (`lg:sticky lg:top-16
  lg:h-[calc(100vh-4rem)]`), so it stays visible while scrolling yet still
  occupies its own width. All `fixed` positioning and `lg:ml-64` offsets were
  removed from the desktop shell; `fixed` + `z-40` remain only for the mobile
  drawer (below `lg`), which is a legitimate overlay.
- **Responsive behavior:** on desktop (`lg` and up) the sidebar is always
  visible in its own column and the main content uses the remaining width; on
  mobile/tablet the sidebar is hidden and the main content takes the full
  width, with the existing hamburger button opening the drawer overlay. Tables
  keep their own `overflow-x-auto` inside `DataTable`, so wide tables scroll
  internally instead of pushing the page wider than the viewport.
- **Verification:** `npm run typecheck` passes; `npm run lint` passes with 0
  errors (4 pre-existing warnings in untouched files); `npm test` gives
  149 passed / 2 failed where both failures are pre-existing
  `tests/auth-url-security.test.ts` percent-encoding expectations in an
  untouched auth-redirect helper; `npx next build` compiles successfully with
  all admin routes (`/admin`, `/admin/categories`, `/admin/services`,
  `/admin/charging-options`, `/admin/pricing`, `/admin/services/[id]`) built.
  `npm run build` itself was not green end-to-end because `prisma generate`
  hit a Windows `EPERM` file-lock rename on
  `node_modules/.prisma/client/query_engine-windows.dll.node` (environmental,
  unrelated to this change). Browser verification at 1366/1440/1920px and
  375/768px was not possible in this environment (no screenshot-capable
  browser; the admin guard also redirects unauthenticated fetches to `/login`),
  so layout was verified from compiled output and source inspection instead.
- **Remaining limitation:** visual pixel-level confirmation (sidebar/content
  alignment, viewport scrolling, drawer behavior at 375/768px) still needs a
  manual pass in a real browser with an admin session.

---

## Changelog - Admin sidebar collapse/expand interaction

**Scope:** UI/layout interaction only in `src/components/admin/Chrome.tsx`.
No change to Prisma schema, seed data, authentication, RBAC, admin API guards,
booking logic, pricing logic, provider/catalog data, or the customer UI.

- **Root cause:** the header hamburger only opened the mobile drawer
  (`lg:hidden` button wired to `drawerOpen`) and had no desktop effect, while
  the desktop sidebar was a permanently expanded `w-64` column with its own
  separate X/close affordance nearby - two disconnected navigation behaviors
  instead of one coherent collapse/expand system.
- **Desktop expanded:** full `w-64` sidebar column - MOYO/Admin-console
  branding, section headings, icon + label items, SOON badges and "View
  customer site" all visible; main uses the remaining width.
- **Desktop collapsed:** narrow `w-20` icon rail, still a structural sticky
  flex column (never `fixed`, never an overlay) - logo icon stays centered,
  all nav icons stay visible/clickable, every text label/heading/SOON badge is
  hidden, and main expands into the freed width via the natural flex layout
  with a subtle `transition-[width] duration-200`.
- **Mobile/tablet (below lg):** unchanged drawer behavior - sidebar hidden,
  the same header hamburger opens the `fixed` overlay drawer, X closes it.
  Desktop `sidebarCollapsed` and mobile `drawerOpen` are separate state and
  never drive each other; the responsive toggle branches on a
  `(min-width: 1024px)` media query.
- **Accessibility:** the toggle carries `aria-controls="admin-sidebar"`,
  `aria-expanded` reflecting the desktop state, and a dynamic
  Collapse/Expand `aria-label`; the sidebar has `id="admin-sidebar"`;
  collapsed icons get `title`/`aria-label` tooltips (no new dependency - the
  project has no tooltip component); active-item highlighting and keyboard
  navigation are unchanged.
- **Files changed:** `src/components/admin/Chrome.tsx` only (plus this
  README entry). No persistence was added - plain `useState`, no
  database/schema change, no sensitive data stored.
- **Verification:** `npm run typecheck` passes; `npm run lint` passes with 0
  errors; `npm test` gives 149 passed / 2 failed where both failures are the
  same pre-existing `tests/auth-url-security.test.ts` percent-encoding
  expectations in the untouched auth-redirect helper; `npx next build`
  compiles with all admin routes built. Authenticated manual verification at
  375/768/1024/1366/1440/1920px (hamburger toggles rail on desktop, drawer on
  mobile, no overlap/scrollbar) still needs a real browser pass with an admin
  session.
- **Known limitation:** collapse state is per-mount UI state (resets on
  navigation reload); no cross-session persistence by design.

---

## Changelog - Admin header toggle wiring fix

**Scope:** interaction wiring only in `src/components/admin/Chrome.tsx`. No
new state, no layout/styling change, no business-logic change.

- **Root cause:** the header used one button whose click branched at runtime
  on `window.matchMedia('(min-width: 1024px)')`. Any drift between that JS
  breakpoint check and the Tailwind `lg` visibility classes meant a desktop
  click could open the (hidden) mobile drawer instead of toggling the
  existing `sidebarCollapsed` rail state, so the hamburger appeared dead when
  the sidebar was collapsed.
- **Fix:** replaced the runtime breakpoint branch with two breakpoint-explicit
  buttons sharing the one header slot - a `hidden lg:block` desktop hamburger
  wired directly to `onClick={() => setSidebarCollapsed((c) => !c)}` (the
  existing state/setter, reused, nothing new), and a `lg:hidden` mobile
  hamburger that only opens the drawer. Same `menu` icon, same
  `aria-expanded={!sidebarCollapsed}` / `aria-controls="admin-sidebar"` /
  Collapse-Expand `aria-label` on the desktop button.
- **Verification:** `npm run typecheck` passes; `npm run lint` passes with 0
  errors; `npx next build` compiles with all admin routes built; `npm test`
  unchanged (149 passed / 2 pre-existing `auth-url-security` failures in the
  untouched auth helper). Manual toggle check still needs an admin browser
  session: collapse, expand, repeat, then mobile drawer open/close below lg.

---

## Changelog - Admin sidebar toggle — browser-verified

**Scope:** `src/components/admin/Chrome.tsx` wiring (already committed) plus
a hydration-safety fix in `src/app/admin/page.tsx`. No new state, no layout
rewrite, no auth/RBAC/API/schema change.

- **Actual root cause found:** two compounding causes. (1) The log at
  `.next/dev/logs/next-development.log` proves the browser's `/admin` tree
  hit a React hydration mismatch and regenerated the entire admin tree on the
  client (`min-h-screen bg-ink-50` server HTML vs `flex min-h-screen flex-col`
  client render) — a regenerated tree replays without the original hydration
  event wiring guarantees, which is exactly the class of failure where a
  button looks clickable but its handler never fires. (2) Inside that same
  SSR tree, `BookingTrendChart` rendered
  `new Date(day.date).toLocaleDateString('en-IN', …)` — locale/ICU output that
  can differ between the Node server and the browser (UTC-midnight parsing
  shifts the calendar day behind UTC), i.e. a genuine server/client HTML
  divergence on `/admin` itself. The log also shows a browser extension
  (`data-new-gr-c-s-check-loaded`, Grammarly-style) mutating `<body>` before
  React hydrated — a second, environmental mismatch source on the tester's
  machine.
- **Fix:** replaced the locale date call with a deterministic
  `formatChartDay()` that parses the `YYYY-MM-DD` key into `DD Mon` with no
  `Date`, no ICU, no timezone — byte-identical on server and client. No
  toggle/state code needed changing: the trace proves the rendered hamburger
  is `Topbar`'s desktop button in `Chrome.tsx` (`onClick=
  {onToggleDesktopSidebar}` → existing `toggleDesktopSidebar` →
  `setSidebarCollapsed((c) => !c)`), the state owner is `AdminShell` in the
  same file, and the sidebar in the same component consumes it with static
  `lg:w-20`/`lg:w-64` classes (no `w-${…}` interpolation, no `lg:` override
  conflict, no remount keys, no effects, no overlay/pointer-events issue).
- **Desktop/mobile behavior:** unchanged from the previous commit — lg+
  hamburger toggles the rail, below-lg opens the drawer, X closes it.
- **Browser verification result:** manual browser interaction could not be
  performed in this environment (no screenshot/automation-capable browser;
  unauthenticated fetches redirect to `/login`). Required tester steps after
  pulling this commit: kill ALL node processes (`taskkill /F /IM node.exe`),
  delete `.next`, run ONE `npm run dev`, disable the Grammarly-style
  extension (or use a clean profile), hard-refresh (`Ctrl+Shift+R`), then the
  9-step click sequence (256px → ~80px → 256px ×3, drawer check below lg).
- **Verification:** `npm run typecheck` passes; `npm run lint` passes with 0
  errors (4 pre-existing warnings); `npx next build` compiles with all admin
  routes built; `npm test` 149 passed / 2 failed — same pre-existing
  `auth-url-security` percent-encoding failures in the untouched auth helper.

---

## Changelog - Admin sidebar — unified collapse/expand control

**Scope:** `src/components/admin/Chrome.tsx` only (plus this changelog entry).
No changes to any `/admin/*` page, chart logic (`CHART_MONTHS` untouched),
auth/RBAC, redirects, pricing, booking data, schema, or the pre-existing
auth-security files.

- **Previous problem:** the desktop three-lines toggle lived in the page
  header (`Topbar`, rendered above the whole app), while the sidebar was a
  column *below* the header with a brand row that owned no control. The
  hamburger therefore read as an unrelated header navigation button, not as
  the sidebar's own collapse control.
- **Final Admin shell structure:** a flex row whose first column is
  `<aside id="admin-sidebar">` and whose second column (`min-w-0 flex-1`)
  contains the header plus `<main>`. The sidebar is a real structural
  column — never `fixed`, never an overlay, no `lg:ml-64`, no absolute
  positioning, no negative margins.
- **Component owning the state:** `AdminShell` in
  `src/components/admin/Chrome.tsx`, with the single boolean
  `const [sidebarCollapsed, setSidebarCollapsed] = useState(false)`. The
  only other nav state is `drawerOpen`, which is the separate below-`lg`
  mobile overlay — not a duplicate.
- **Component rendering the three-lines button:** the sidebar's own brand
  row inside `AdminShell`'s `<aside id="admin-sidebar">` (☰ ⚡ MOYO /
  Admin console when expanded, ☰ ⚡ when collapsed). `Topbar` no longer
  receives any desktop-toggle props and renders no desktop hamburger; it
  keeps only the page title, administrator identity/role/avatar/logout, and
  the below-`lg` drawer hamburger.
- **Widths:** expanded `w-64` (256px), collapsed `w-20` (~80px icon rail),
  complete static Tailwind classes in one conditional
  (`sidebarCollapsed ? 'w-20' : 'w-64'`), plus `shrink-0 overflow-hidden
  transition-[width] duration-200` and `lg:sticky lg:top-0 lg:h-screen`.
- **Toggle semantics:** the same button performs both directions via
  `onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}`, with
  `aria-controls="admin-sidebar"`, `aria-expanded={!sidebarCollapsed}` and
  `aria-label` flipping between "Expand admin sidebar" and
  "Collapse admin sidebar". Collapsed icons keep their `title`/`aria-label`
  tooltips (already provided by `NavList`); the button is keyboard
  focusable and operable.
- **Mobile behavior (below `lg`):** the desktop rail never renders (aside is
  `hidden` below `lg`); the header hamburger opens the overlay drawer and
  the drawer's X closes it. Desktop `sidebarCollapsed` is untouched by the
  drawer. No desktop X exists or was added.
- **Browser verification (all performed against the dev server with a real
  headless Chromium, logged in as the admin seed account):**
  - Desktop: 5 pages (`/admin`, `/admin/categories`, `/admin/services`,
    `/admin/charging-options`, `/admin/pricing`) × 4 widths (1024, 1366,
    1440, 1920) × 3 full click cycles each — every cycle: expanded w-64 →
    SAME button click → collapsed w-80 icon rail → SAME button click →
    expanded w-64, with matching `aria-expanded`/`aria-label`, hidden
    labels/headings/SOON/site text when collapsed, restored when expanded,
    main width growing on collapse, no overlap, no horizontal overflow, no
    navigation/reload.
  - Mobile: 375 and 768 — no desktop rail, hamburger opens drawer, X
    closes it, no overflow, drawer never touches desktop state.
  - Keyboard: focus reaches the sidebar toggle and toggling changes width
    (256 → 80).
  - Total: **977 checks passed**; the single failing probe was the console
    network check because the app ships no `favicon.ico` (pre-existing
    `/favicon.ico` → 404 on every admin page load, unrelated to this
    change). No uncaught exceptions, no hydration errors in the clean
    session. Expanded/collapsed screenshots at 1440×900 were captured and
    visually reviewed (full sidebar with sidebar-owned ☰ toggle; clean
    icon rail beside an expanded dashboard).
- **Static verification:** `npm run typecheck` ✅, `npm run lint` ✅ (0
  errors; the same 4 pre-existing warnings in unrelated files), `npm test`
  ✅ (149 passed / the same 2 pre-existing `auth-url-security` failures in
  the untouched auth helper), `npx next build` ✅ (19/19 pages, all admin
  routes).
- **Caution:** creating the page twice in the same browser tab (e.g. a
  duplicated automated tab) can interleave state — run one browser tab per
  session in manual testing.

## Changelog - Chart month initialization runtime fix

**Scope:** `src/app/admin/page.tsx` only. No sidebar/layout, auth/RBAC,
pricing, booking-data or schema changes.

- **Root cause:** runtime `ReferenceError: Cannot access 'CHART_MONTHS'
  before initialization` at `formatChartDay()` (`page.tsx`) — a temporal
  dead zone crash: the `const CHART_MONTHS` binding was referenced while
  still uninitialized in the executed dev bundle. Typecheck/lint cannot
  catch this; it only throws at runtime.
- **Fix:** hoisted the single `const CHART_MONTHS` declaration to the top of
  the module, above `AdminDashboardPage`, `formatChartDay()` and
  `BookingTrendChart()`, so it is initialized before any invocation can
  occur regardless of bundler or hot-reload evaluation order. Exactly one
  declaration exists in the module (verified); the deterministic
  `formatChartDay()` `DD Mon` logic and chart data model are unchanged.
- **Verification:** `npm run typecheck`, `npm run lint` (0 errors),
  `npx next build` all pass; exactly one dev server listens on :3000;
  unauthenticated `/admin` returns the expected 307 to `/login`. The
  authenticated 9-step hamburger click sequence still requires a tester
  browser session and was not performed here.

---

## Changelog - Fix post-login 404 at `/account`

**Scope:** missing customer route + role-aware post-login destinations. No
auth-security weakening.

- **Root cause:** every login/register success path defaulted to `/account`
  (`safeRedirectPath(..., '/account')` in both auth APIs, both auth pages, and
  the header link), but no `src/app/**/account/page.tsx` existed, so the
  fallback destination itself 404'd. The proxy already treats `/account` as
  protected, which confirms it was the intended customer landing page.
- **Routes added:** `src/app/(customer)/account/page.tsx` — server-authenticated
  via `getCurrentUser()`; anonymous users go to `/login?next=/account`; ADMIN
  users redirect to `/admin`. Profile, saved address, and the 3 most recent
  OWN bookings (scoped by session id) render from real data only; an empty
  history shows an honest empty state, never invented rows. Links go only to
  real pages (`/categories`, `/book`, `/bookings`).
- **Redirect rules fixed (`src/lib/redirect.ts`):** new `resolvePostLoginRedirect()`
  honours a safe `next` only when the server-resolved role may use it; `/admin`
  destinations are never handed to non-ADMIN callers. (Landing defaults were
  later changed to the public homepage `/` for both roles — see the
  homepage-first entry below.) Wired into
  `POST /api/auth/login` (DB role), `POST /api/auth/register` (hard-coded
  CUSTOMER — signup still cannot choose ADMIN), and the already-signed-in hop
  on `/login` and `/register`.
- **Security preserved:** credentials still travel only in the POST body; `next`
  still rejects external, protocol-relative, backslash, authority-confusion, and
  credential-bearing destinations; customers still get access-denied (never admin
  content) on `/admin`; CSRF/Origin/session/rate-limit controls untouched.
- **Tests:** new `tests/post-login-redirect.test.ts` (6 cases) pins the
  role-aware contract.
- **Verification:** TYPECHECK/LINT/TEST/BUILD PENDING — the sandbox terminal
  could not execute them (no output observability); run `npm run typecheck`,
  `npm run lint`, `npm test`, `npx next build` plus the admin/customer browser
  flows before merging.
- **Remaining limitations:** browser login flows not yet performed here; the two
  pre-existing `auth-url-security` percent-encoding failures noted in earlier
  changelog entries are untouched.

---

## Changelog - Personal Account page for every user (incl. ADMIN)

**Scope:** `/account` access + profile/address/password management. No
auth-security weakening; no Admin Console change.

- **Why Account previously redirected to Admin:** `src/app/(customer)/account/page.tsx`
  line 29 ran `if (user.role === 'ADMIN') redirect('/admin')`. That line confused
  the post-login *landing* decision (ADMIN → `/admin` at the time — since
  changed to the public homepage `/` for every role, see the homepage-first
  entry below) with the *navigation* destination: an admin who
  explicitly opened Account was bounced to the console and could never reach
  their own profile. The line is removed; the login default is untouched.
- **Routes:** `/account` now serves every authenticated role (anonymous →
  `/login?next=/account`). Header avatar and mobile bottom-nav Account item both
  resolve to `/account` when signed in. ADMIN users get a separate,
  clearly-labelled **Admin Console** link on the account page; the page itself is
  never the admin dashboard, and `/admin` server-side role checks are unchanged.
- **Editable vs read-only:** editable — full name, phone, saved address
  (label/line1/line2/landmark/area/city/state/pincode). Read-only — email (no
  verified email-change flow exists), role, member-since, last login. No schema
  migration was needed (`CustomerAddress` already exists).
- **APIs:** `GET`+`PATCH /api/account/profile`, `PUT /api/account/address`,
  `POST /api/account/password`. Identity always from the verified session; no
  user-id parameter exists. `.strict()` Zod schemas reject `role`/`email`/
  `isActive`/`passwordHash` and every other privileged key. Guard chain mirrors
  admin writes: `assertSameOrigin → session → per-account rate limit →
  assertCsrf → strict parse → session-scoped query`.
- **Password change:** current-password bcrypt verification, established policy
  (12+ chars, mixed case, number, symbol), confirmation match, reuse rejection,
  per-account rate limit (5/15 min). Success revokes ALL sessions via the
  existing `destroyAllSessions()` (DB-backed sessions make this complete — no
  JWT can outlive it) and clears cookies, so the user MUST sign in again; the UI
  navigates to `/login` and says so. `PASSWORD_CHANGED` audit row carries no
  secrets; no password/hash/body is logged or returned.
- **Tests:** new `tests/account.test.ts` (19 cases: auth, self-only isolation,
  mass-assignment refusal, email read-only, wrong-password/policy/mismatch/reuse
  rejection, CSRF/Origin, no-leak, revocation, ADMIN parity). Earlier
  redirect-security suites untouched.
- **Verification:** TYPECHECK/LINT/TEST/BUILD PENDING — the sandbox terminal
  still cannot execute commands (no output observability); run `npm run
  typecheck`, `npm run lint`, `npm test`, `npx next build` plus ADMIN+CUSTOMER
  browser flows before merging.
- **Remaining limitations:** browser verification not performed here; no
  password-recovery or email-change flows (documented read-only); rate limiter
  stays per-process (see SECURITY.md §6).

---

## Changelog - Homepage-first login + registration flow

**Scope:** post-login/registration destinations in `src/lib/redirect.ts`, the
auth APIs, and the `/login` + `/register` pages. Account navigation and all
open-redirect/CSRF/Origin/RBAC protections unchanged.

- **Login defaults now homepage-first:** `defaultLandingForRole()` returns `/`
  for **every** role. ADMIN and CUSTOMER with no explicit `next` both land on
  the public homepage `/`. Neither `/account` nor `/admin` is ever an automatic
  post-login destination — the personal Account page and the Admin Console are
  reached deliberately via their own navigation links. (This supersedes the
  earlier role-based landing rule recorded in the two changelog entries above.)
- **Explicit `next` still honoured:** a valid, safe local `next` is honoured when
  the server-resolved role may use it — `?next=/account` works for any role,
  `?next=/admin` only for ADMIN (everyone else falls back to `/`). Unsafe
  `next` (external, `//host`, backslash, control chars, credential-bearing) is
  rejected and falls back to `/`. Role is always read from the DB session, never
  from client input.
- **Registration → Login → Homepage:** `POST /api/auth/register` still creates
  the CUSTOMER account but does **not** mint a session — the new user must
  authenticate explicitly. The browser is sent to `/login?registered=1`; the
  Login page shows a clear success message driven by that non-sensitive flag. A
  safe, explicitly requested `next` is preserved through the hop
  (`/login?registered=1&next=…`) and applied only after a real, role-authorized
  login. No credentials ever appear in a URL (they travel only in the POST body).
- **Global Account navigation:** the shared customer shell's Account item is
  `/account` on both desktop (header avatar) and mobile (bottom nav) for any
  signed-in role; anonymous users are sent to `/login?next=%2Faccount` and
  returned to `/account` after login. A separate Admin Console link remains for
  ADMIN; customers can never reach `/admin` via navigation or a crafted `next`.
- **Tests:** `tests/post-login-redirect.test.ts` (7 cases) and
  `tests/registration-flow.test.ts` (6 cases) pin the homepage-first defaults,
  safe-`next` handling, role guard, and the registration→login (no-session)
  sequence. New `tests/navigation.test.ts` (7 cases) renders the real
  `CustomerHeader`/`BottomNav` server components and pins the Account
  destination per session state (`/account` for every signed-in role,
  `/login?next=%2Faccount` anonymous, never `/admin`) plus the `(customer)`
  layout wiring that carries it on every public/customer route. Earlier
  redirect-security suites are untouched.
- **Verification:** `npm run typecheck`, `npm run lint` (0 errors; 4
  pre-existing warnings in files this change does not touch) and `npm test`
  (187/187 across 14 files) all pass; `npx next build` succeeds. Browser
  verification of the ADMIN/CUSTOMER/anonymous login, registration, and
  Account navigation flows was not performed here (no browser available in
  this environment) and should be run before merging.