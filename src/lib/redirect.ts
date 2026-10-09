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
    // On auth pages only a validated `next` may survive. Emit its RAW value
    // verbatim (never re-serialise via `URLSearchParams`), so the leading
    // slash stays `/` instead of being re-encoded to `%2F`. `next` was already
    // proven a safe local path by `safeRedirectPath`, so echoing it raw cannot
    // reinterpret it as a credential carrier.
    const next = url.searchParams.get('next');
    const keepNext =
      next !== null && safeRedirectPath(next, '') !== '' ? `next=${next}` : null;
    // Compare against the raw original query to detect a real change.
    const rawQuery = url.search.slice(1);
    const rebuiltQuery = keepNext ?? '';
    if (rebuiltQuery === rawQuery) return null;
    return `${url.origin}${url.pathname}${rebuiltQuery ? `?${rebuiltQuery}` : ''}`;
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