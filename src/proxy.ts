import { NextResponse, type NextRequest } from 'next/server';
import { stripCredentialParams } from '@/lib/redirect';

/**
 * EDGE PROXY (Next.js 16 renamed `middleware` -> `proxy`)
 *
 * Responsibilities (defence in depth, NOT the primary authorization layer):
 *  1. Attach a strict Content-Security-Policy to every response.
 *  2. Redirect unauthenticated users away from /admin and account pages before
 *     any server component renders. This is a UX optimisation only - every
 *     page and API route independently re-checks the session and role against
 *     the database.
 *  3. Scrub credential-bearing query parameters from incoming GET URLs
 *     (`/login?identifier=…&password=…` -> `/login`) so credentials can never
 *     be rendered, cached, bookmarked, or leaked via Referer, no matter how a
 *     URL was produced. This complements the login form, which always submits
 *     credentials via POST to `/api/auth/login`.
 *
 * SECURITY NOTE: this runs in the Edge runtime and has NO database access. It
 * only checks whether a session cookie is *present*. It must never be treated
 * as proof of authentication or of a particular role.
 *
 * NOTE: no Node.js APIs (node:crypto) are used here; the nonce is derived from
 * the globally available Web Crypto `crypto.randomUUID()`.
 */

const SESSION_COOKIE = 'moyo_session';

/** Path prefixes that require an authenticated session. */
const PROTECTED_PREFIXES = ['/admin', '/account', '/bookings', '/orders'];

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    isDev
      ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    isDev ? '' : 'upgrade-insecure-requests',
  ]
    .filter(Boolean)
    .join('; ');
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Web Crypto is available in the Edge runtime; Node's crypto module is not.
  const nonce = btoa(crypto.randomUUID()).replace(/=+$/, '');

  // 3. Credential scrub: never let `?password=` / `?identifier=` survive on
  //    any GET URL. The redirect target is re-checked by this same function
  //    on the next hop, where it comes back clean, so no loop is possible.
  if ((request.method === 'GET' || request.method === 'HEAD') && search) {
    const cleanUrl = stripCredentialParams(request.url);
    if (cleanUrl !== null) {
      return withSecurityHeaders(NextResponse.redirect(cleanUrl, 307), nonce, pathname);
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (needsAuth && !hasSessionCookie) {
    const loginUrl = new URL('/login', request.url);
    // Only a relative, validated path is preserved - never an absolute URL,
    // which would enable an open redirect.
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return withSecurityHeaders(NextResponse.redirect(loginUrl), nonce, pathname);
  }

  return withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    nonce,
    pathname,
  );
}

/**
 * `Referrer-Policy: no-referrer` on authentication surfaces (`/login`,
 * `/register`, `/api/auth/*`) so a credential-bearing URL could never leak
 * through a Referer header even if one were ever produced. Everywhere else the
 * existing `strict-origin-when-cross-origin` policy is kept unchanged.
 */
function referrerPolicyFor(pathname: string | undefined): string {
  if (
    pathname === '/login' ||
    pathname === '/register' ||
    (pathname ?? '').startsWith('/api/auth/')
  ) {
    return 'no-referrer';
  }
  return 'strict-origin-when-cross-origin';
}

function withSecurityHeaders(
  response: NextResponse,
  nonce: string,
  pathname?: string,
): NextResponse {
  response.headers.set('Content-Security-Policy', buildCsp(nonce));
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', referrerPolicyFor(pathname));
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), interest-cohort=()',
  );
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('X-Powered-By', 'Moyo');

  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // Never cache authenticated HTML.
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files, so the proxy does not
     * run needless work for hashed build assets.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};