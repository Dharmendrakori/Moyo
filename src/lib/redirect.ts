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
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/account'): string {
  if (!next) return fallback;
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/')) return fallback;
  // Protocol-relative URL: "//evil.com"
  if (next.startsWith('//')) return fallback;
  if (next.includes('\\')) return fallback;
  if (/[\u0000-\u001F\u007F]/.test(next)) return fallback;
  if (/^\/[^\/]*@/.test(next)) return fallback;
  return next;
}