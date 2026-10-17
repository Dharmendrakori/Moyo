/// <reference types="vitest/globals" />

/**
 * EDGE PROXY GUARD (src/proxy.ts) - the layer that produced the reported
 * `ERR_TOO_MANY_REDIRECTS` at `/login?next=/bookings`.
 *
 * `proxy()` is the Next.js 16 renamed middleware and the ONLY edge layer in
 * this app (there is no `src/middleware.ts`). It is driven directly here with
 * REAL `NextRequest` objects, so the actual redirect decisions are asserted
 * rather than assumed. The properties pinned are the ones that must never
 * regress:
 *
 *   - an anonymous `/bookings` visit is redirected to `/login?next=%2Fbookings`;
 *   - `/login?next=/bookings` is served (200) and NEVER redirected to itself -
 *     the exact regression that caused the browser redirect loop;
 *   - `/login`, `/register` and the auth API stay reachable with no session;
 *   - credential-bearing query strings are scrubbed, and the scrub redirect is
 *     idempotent (following it lands on a 200, ending the chain);
 *   - a redirect target always differs from the URL being served;
 *   - security headers (CSP, frame options, referrer policy) are preserved.
 */

import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

const ORIGIN = 'http://localhost:3000';

function get(path: string, opts: { cookie?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new NextRequest(`${ORIGIN}${path}`, { method: 'GET', headers });
}

function location(res: Response): URL | null {
  const loc = res.headers.get('location');
  return loc ? new URL(loc, ORIGIN) : null;
}

describe('proxy: unauthenticated /bookings is redirected to sign in', () => {
  it('sends an anonymous /bookings visitor to /login?next=%2Fbookings', () => {
    const res = proxy(get('/bookings'));
    expect(res.status).toBe(307);
    const loc = location(res);
    expect(loc?.pathname).toBe('/login');
    expect(loc?.searchParams.get('next')).toBe('/bookings');
  });

  it('never redirects a target back onto the URL being served (no self-loop)', () => {
    const res = proxy(get('/bookings'));
    const loc = location(res);
    // The destination must differ from the request URL.
    expect(`${loc?.pathname}${loc?.search}`).not.toBe('/bookings');
  });

  it('keeps a deep /bookings/:id request protected too', () => {
    const res = proxy(get('/bookings/b-123'));
    expect(res.status).toBe(307);
    expect(location(res)?.pathname).toBe('/login');
  });
});

describe('proxy: the login page is never redirected to itself (no loop)', () => {
  // This is the precise regression: `/login?next=/bookings` used to 307 back to
  // `/login?next=/bookings`, so the browser hit ERR_TOO_MANY_REDIRECTS.
  it('serves /login?next=/bookings with 200 and no Location header', () => {
    const res = proxy(get('/login?next=/bookings'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('serves the percent-encoded form /login?next=%2Fbookings with 200 too (no redirect)', () => {
    // The server re-encodes the incoming URL, so `?next=%2Fbookings` is exactly
    // what the browser is redirected to from /bookings. It MUST be treated as
    // already-clean, or the raw-vs-decoded query comparison loops forever.
    const res = proxy(get('/login?next=%2Fbookings'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('serves a bare /login with 200', () => {
    expect(proxy(get('/login')).status).toBe(200);
  });

  it('treats the literal and percent-encoded next identically (both clean)', () => {
    expect(proxy(get('/login?next=/bookings')).status).toBe(200);
    expect(proxy(get('/login?next=%2Fbookings')).status).toBe(200);
  });
});

describe('proxy: public auth surfaces stay reachable without a session', () => {
  for (const path of ['/login', '/register', '/login?next=/bookings', '/login?next=%2Fbookings']) {
    it(`serves ${path} directly (200, no redirect)`, () => {
      const res = proxy(get(path));
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });
  }
});

describe('proxy: an authenticated session passes through protected pages', () => {
  it('serves /bookings (200, no redirect) when a session cookie is present', () => {
    const res = proxy(get('/bookings', { cookie: 'moyo_session=some-token' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('proxy: credential scrubbing is idempotent (no loop)', () => {
  it('scrubs ?identifier=..&password=.. from /login down to /login', () => {
    const res = proxy(get('/login?identifier=user%40x.com&password=secret123'));
    expect(res.status).toBe(307);
    const loc = location(res);
    expect(loc?.pathname).toBe('/login');
    expect(loc?.search).toBe('');
  });

  it('ends the chain: following the scrub lands on a 200 (no second redirect)', () => {
    const first = proxy(get('/login?identifier=user%40x.com&password=secret123'));
    const target = location(first);
    expect(target).not.toBeNull();
    // Re-enter the proxy with the already-clean URL - it must NOT redirect again.
    const second = proxy(get(`${target?.pathname}${target?.search}`));
    expect(second.status).toBe(200);
    expect(second.headers.get('location')).toBeNull();
  });

  it('keeps only a validated next while dropping credentials', () => {
    const res = proxy(get('/login?password=x&next=/bookings'));
    const loc = location(res);
    expect(loc?.pathname).toBe('/login');
    expect(loc?.searchParams.get('next')).toBe('/bookings');
    expect(loc?.searchParams.has('password')).toBe(false);
  });
});

describe('proxy: security headers are preserved on every response', () => {
  it('attaches CSP, frame options and auth-surface referrer policy to a redirect', () => {
    const res = proxy(get('/bookings'));
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('uses no-referrer on the login surface and strict-origin elsewhere', () => {
    expect(proxy(get('/login')).headers.get('referrer-policy')).toBe('no-referrer');
    expect(proxy(get('/bookings')).headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });
});
