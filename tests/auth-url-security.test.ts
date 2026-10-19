/// <reference types="vitest/globals" />

import { safeRedirectPath, stripCredentialParams } from '../src/lib/redirect';

/**
 * CREDENTIAL-IN-URL DEFENCES
 *
 * Two layers, one shared contract (`SENSITIVE_PARAM_KEYS`):
 *  1. `safeRedirectPath` REJECTS any `next` destination whose query string or
 *     fragment names a credential-like parameter - a destination names a
 *     place, never a credential carrier.
 *  2. `stripCredentialParams` SCRUBS credential-bearing query parameters out
 *     of any URL (edge proxy), so hand-crafted `/login?identifier=…&password=…`
 *     links die before the page renders, enters history, or leaks as Referer.
 */
describe('safeRedirectPath credential check', () => {
  it('accepts a safe path with a benign query string', () => {
    expect(safeRedirectPath('/account?tab=orders')).toBe('/account?tab=orders');
    expect(safeRedirectPath('/bookings?page=2&sort=asc')).toBe('/bookings?page=2&sort=asc');
  });

  it('rejects every sensitive parameter name in the query string', () => {
    for (const key of [
      'password', 'passwd', 'pwd', 'secret', 'token', 'access_token',
      'refresh_token', 'id_token', 'otp', 'csrf', 'session', 'authorization', 'identifier',
    ]) {
      expect(safeRedirectPath(`/account?${key}=x`)).toBe('/account');
      expect(safeRedirectPath(`/login?tab=a&${key}=x`)).toBe('/account');
    }
  });

  it('rejects sensitive keys case-insensitively and valueless', () => {
    expect(safeRedirectPath('/account?PASSWORD=x')).toBe('/account');
    expect(safeRedirectPath('/account?Token=x')).toBe('/account');
    expect(safeRedirectPath('/account?password')).toBe('/account');
  });

  it('rejects percent-encoded and double-encoded credential keys', () => {
    // `%3D` is `=`: `/account%3Fpassword%3Dx` decodes to `/account?password=x`.
    expect(safeRedirectPath('/account%3Fpassword%3Dx')).toBe('/account');
    // Double-encoded: `%253F` -> `%3F` -> `?`.
    expect(safeRedirectPath('/account%253Fpassword%253Dx')).toBe('/account');
    // Encoded key name: `p%61ssword` is still `password`.
    expect(safeRedirectPath('/account?p%61ssword=x')).toBe('/account');
  });

  it('rejects sensitive keys smuggled in the fragment', () => {
    expect(safeRedirectPath('/account#password=x')).toBe('/account');
    expect(safeRedirectPath('/account?tab=a#token=x')).toBe('/account');
  });

  it('still accepts lookalike-but-safe keys', () => {
    expect(safeRedirectPath('/account?passport=x')).toBe('/account?passport=x');
    expect(safeRedirectPath('/account?tokens=x')).toBe('/account?tokens=x');
  });
});

describe('stripCredentialParams', () => {
  const ORIGIN = 'https://seric.example';

  it('returns null for an already-clean URL (no redirect loop)', () => {
    expect(stripCredentialParams(`${ORIGIN}/login`)).toBeNull();
    expect(stripCredentialParams(`${ORIGIN}/login?next=/account`)).toBeNull();
    expect(stripCredentialParams(`${ORIGIN}/account?tab=orders`)).toBeNull();
  });

  it('scrubs the reported attack URL on /login', () => {
    expect(
      stripCredentialParams(`${ORIGIN}/login?identifier=user%40x.com&password=secret123`),
    ).toBe(`${ORIGIN}/login`);
  });

  it('keeps only a validated next on /login and /register', () => {
    expect(stripCredentialParams(`${ORIGIN}/login?next=/account&foo=bar`)).toBe(
      `${ORIGIN}/login?next=/account`,
    );
    expect(stripCredentialParams(`${ORIGIN}/register?next=/account`)).toBeNull();
    // An unsafe next is dropped too, leaving the bare page.
    expect(stripCredentialParams(`${ORIGIN}/login?next=https://evil.com`)).toBe(
      `${ORIGIN}/login`,
    );
    expect(stripCredentialParams(`${ORIGIN}/login?next=/x%3Fpassword%3Dy`)).toBe(
      `${ORIGIN}/login`,
    );
  });

  it('deletes only sensitive keys on ordinary pages, preserving the rest', () => {
    expect(
      stripCredentialParams(`${ORIGIN}/account?tab=orders&password=x&token=y`),
    ).toBe(`${ORIGIN}/account?tab=orders`);
    expect(stripCredentialParams(`${ORIGIN}/orders?otp=1&page=2`)).toBe(
      `${ORIGIN}/orders?page=2`,
    );
  });

  it('is idempotent: following the redirect ends the chain', () => {
    const once = stripCredentialParams(`${ORIGIN}/login?password=x&next=/account`);
    expect(once).toBe(`${ORIGIN}/login?next=/account`);
    expect(stripCredentialParams(once as string)).toBeNull();
  });

  // Regression: the running Next.js server RE-ENCODES the incoming URL, so the
  // browser is redirected to `/login?next=%2Fbookings` (percent-encoded slash),
  // not `/login?next=/bookings`. A raw-vs-decoded query comparison treated that
  // as "dirty" and 307'd back to the literal form, which the server re-encoded
  // again -> ERR_TOO_MANY_REDIRECTS. Cleanliness must be decided from the PARSED
  // parameters, so any encoding of a single safe `next` is already clean.
  it('treats a percent-encoded next on /login as already clean (no loop)', () => {
    expect(stripCredentialParams(`${ORIGIN}/login?next=%2Fbookings`)).toBeNull();
    expect(stripCredentialParams(`${ORIGIN}/login?next=%2Faccount`)).toBeNull();
  });

  it('treats literal and percent-encoded forms of the same next identically', () => {
    expect(stripCredentialParams(`${ORIGIN}/login?next=/bookings`)).toBe(
      stripCredentialParams(`${ORIGIN}/login?next=%2Fbookings`),
    );
  });

  it('still scrubs credentials even alongside an encoded next', () => {
    expect(
      stripCredentialParams(`${ORIGIN}/login?password=x&next=%2Fbookings`),
    ).toBe(`${ORIGIN}/login?next=/bookings`);
    // And the scrubbed result is then clean (chain terminates).
    expect(stripCredentialParams(`${ORIGIN}/login?next=/bookings`)).toBeNull();
  });
});
