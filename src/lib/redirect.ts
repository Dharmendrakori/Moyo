/**
 * OPEN REDIRECT PREVENTION
 *
 * Used when returning to a page after login. Only same-origin absolute PATHS are
 * accepted.
 *
 * Rejected:
 *   - anything not starting with a single "/" (absolute URLs, "javascript:…")
 *   - protocol-relative URLs ("//evil.com")
 *   - backslashes, which some parsers normalise to "/"
 *   - control characters used to smuggle a second header or line
 *   - paths whose first segment looks like "user@host" (authority confusion)
 *   - paths whose query string or fragment carries credential-like parameter
 *     names (password, token, OTP, ...), including percent-encoded variants.
 *     A redirect target names a DESTINATION, never a credential carrier, so
 *     `next=/x?password=…` can never move credentials into a URL.
 */

/**
 * Query-parameter names that must never appear in any URL this application
 * emits, follows, or renders. Shared by `safeRedirectPath` and the edge proxy
 * query stripper so both layers agree on what a credential looks like.
 */
export const SENSITIVE_PARAM_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'otp',
  'csrf',
  'session',
  'authorization',
  'identifier',
]);

/** Percent-decodes up to 3 passes so double-encoded payloads are also caught. */
function decodeFully(value: string): string {
  let out = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch {
      // Malformed percent-encoding: keep the last good decoding.
      break;
    }
  }
  return out;
}

/**
 * True when the query string or fragment of `value` names a sensitive
 * parameter. Both the raw and the fully-decoded form are checked, so
 * a percent-encoded payload is rejected exactly like its plain form.
 */
function hasSensitiveParamKey(value: string): boolean {
  for (const candidate of [value, decodeFully(value)]) {
    const cut = candidate.search(/[?#]/);
    if (cut === -1) continue;
    for (const pair of candidate.slice(cut + 1).split(/[&#]/)) {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      if (key && SENSITIVE_PARAM_KEYS.has(decodeFully(key).toLowerCase())) return true;
    }
  }
  return false;
}

export function safeRedirectPath(next: string | null | undefined, fallback = '/account'): string {
  if (!next) return fallback;
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/')) return fallback;
  // Protocol-relative URL: "//evil.com"
  if (next.startsWith('//')) return fallback;
  if (next.includes('\\')) return fallback;
  if (/[\u0000-\u001F\u007F]/.test(next)) return fallback;
  if (/^\/[^\/]*@/.test(next)) return fallback;
  // A destination path must never carry credential-like parameters.
  if (hasSensitiveParamKey(next)) return fallback;
  return next;
}

/** Query-string allowed list for `/login` and `/register`: only `next` survives. */
const AUTH_PAGE_PATHS = new Set(['/login', '/register']);

/**
 * Returns a copy of `rawUrl` with credential-bearing query parameters removed,
 * or `null` when the URL is already clean (so no redirect is needed).
 *
 * - On `/login` and `/register` only a validated `next` may survive, so a
 *   hand-crafted `/login?identifier=…&password=…` is scrubbed before the page
 *   renders, before it enters browser history, and before it can leak as a
 *   referrer.
 * - Everywhere else only the keys in `SENSITIVE_PARAM_KEYS` are deleted and
 *   every other parameter is preserved untouched.
 *
 * The transformation is idempotent: following the redirect re-enters this
 * function, finds a clean URL, and returns `null`, so no loop is possible.
 */
export function stripCredentialParams(rawUrl: string): string | null {
  const url = new URL(rawUrl);

  if (AUTH_PAGE_PATHS.has(url.pathname)) {
    // On auth pages only a validated `next` may survive. Emit its value with a
    // literal leading slash (never re-serialise via `URLSearchParams`), so `/`
    // stays `/` instead of being encoded to `%2F`. `next` was already proven a
    // safe local path by `safeRedirectPath`, so echoing it back cannot
    // reinterpret it as a credential carrier.
    const params = [...url.searchParams];
    const next = url.searchParams.get('next');
    const nextIsSafe = next !== null && safeRedirectPath(next, '') !== '';

    // Decide cleanliness SEMANTICALLY from the parsed parameters - never from a
    // raw query-string comparison. The running server re-encodes the incoming
    // URL on every hop (`next=/bookings` arrives back as `next=%2Fbookings`), so
    // comparing a rebuilt query that uses a literal `/` against the raw encoded
    // query never converges and produces a 307 -> 307 -> ... redirect loop
    // (ERR_TOO_MANY_REDIRECTS). A URL that carries nothing but a single safe
    // `next` - in ANY encoding - is already clean.
    const [firstParam] = params;
    const alreadyClean =
      firstParam === undefined ||
      (params.length === 1 && firstParam[0] === 'next' && nextIsSafe);
    if (alreadyClean) return null;

    return `${url.origin}${url.pathname}${nextIsSafe ? `?next=${next}` : ''}`;
  }

  for (const key of [...new Set(url.searchParams.keys())]) {
    if (SENSITIVE_PARAM_KEYS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  return url.search !== (new URL(rawUrl)).search ? url.toString() : null;
}

/**
 * POST-LOGIN DESTINATION RESOLUTION (role-aware)
 *
 * `safeRedirectPath` guarantees a destination is a safe local path. These
 * helpers add the second half of the contract: the destination must also be
 * appropriate for the *server-resolved* role. The role always comes from the
 * verified database session - never from a client parameter - so a CUSTOMER
 * cannot reach `/admin` by crafting `?next=/admin`, and an ADMIN who signs in
 * without an explicit destination lands on the public homepage `/` - the same
 * homepage-first default as every other role.
 */

export function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/');
}

/**
 * Default landing page for a server-resolved role.
 *
 * Both roles land on the public homepage `/` after a successful login with no
 * explicit `next`. Personal account management is reached deliberately via the
 * Account navigation link, and the Admin Console via its own link - neither is
 * ever a default post-login destination.
 */
export function defaultLandingForRole(_role: string | null | undefined): string {
  return '/';
}

/**
 * Resolve the post-login destination for a user whose role was read from the
 * database session.
 *
 * - A validated, safe `next` is honoured when the role may use it.
 * - `/admin` destinations are only honoured for ADMIN callers; everyone else
 *   falls back to their own landing page (never to an admin surface).
 * - Missing / unsafe `next` falls back to the role's default landing page.
 * - The return value is always a safe local path (via `safeRedirectPath`).
 */
export function resolvePostLoginRedirect(
  requested: string | string[] | null | undefined,
  role: string | null | undefined,
): string {
  const fallback = defaultLandingForRole(role);
  const first = Array.isArray(requested) ? requested[0] : requested;
  const validated = safeRedirectPath(first, '');
  if (!validated) return fallback;
  if (isAdminPath(validated) && role !== 'ADMIN') return fallback;
  return validated;
}