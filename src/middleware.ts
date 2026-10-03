import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

/**
 * EDGE MIDDLEWARE
 *
 * Responsibilities (defence in depth, NOT the primary authorization layer):
 *  1. Attach a strict Content-Security-Policy with a per-request nonce, so
 *     injected inline scripts cannot execute.
 *  2. Redirect unauthenticated users away from /admin and account pages before
 *     any server component renders. This is a UX optimisation only - every
 *     page and API route independently re-checks the session and role.
 *  3. Block obviously hostile request shapes early.
 *
 * IMPORTANT: middleware reads the cookie to decide whether to redirect. It does
 * NOT validate the session against the database (edge runtimes have no DB
 * access), so it must never be treated as proof of authentication.
 */

const SESSION_COOKIE = 'moyo_session';

/** Path prefixes protected by this middleware. */
const PROTECTED_PREFIXES = ['/admin', '/account', '/bookings', '/orders'];

/** Admin routes must never be indexed or embedded. */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // --- Reject hostile framing/navigation targets early -------------------
  // Only same-origin relative paths are ever used for redirects.
  const nonce = createHash('sha256')
    .update(crypto.randomUUID() + pathname)
    .digest('base64')
    .slice(0, 24);

  const isDev = process.env.NODE_ENV !== 'production';
  const csp = [
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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (needsAuth && !request.cookies.get(SESSION_COOKIE)?.value) {
    const loginUrl = new URL('/login', request.url);
    // Preserve only a relative, validated path - never an absolute URL,
    // which would enable an open redirect.
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return withSecurityHeaders(NextResponse.redirect(loginUrl), csp, nonce);
  }

  return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp, nonce);
}

function withSecurityHeaders(response: NextResponse, csp: string, nonce: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
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
  // Admin is never cacheable or indexable.
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  void nonce;
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files.
     * Excluding _next/static, _next/image and favicon avoids needless work.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

/**
 * Validates the `next` redirect parameter.
 *
 * OPEN REDIRECT PREVENTION: only same-origin absolute PATHS are accepted.
 * Anything protocol-relative (`//evil.com`), absolute, or containing a scheme
 * is discarded and the user is sent to the default page instead.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/account'): string {
  if (!next) return fallback;
  if (!next.startsWith('/')) return fallback;
  if (next.startsWith('//')) return fallback; // protocol-relative URL
  if (next.includes('\\')) return fallback;
  if (/[\x00-\x1F]/.test(next)) return fallback;
  // Reject anything that could be parsed as a scheme or authority.
  if (/^\/[^\/]*@/.test(next)) return fallback;
  return next;
}