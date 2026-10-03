/// <reference types="vitest/globals" />
import { safeRedirectPath } from '../src/lib/redirect';
import { isBookingStatus, isRole, ROLES } from '../src/lib/domain';

/**
 * OPEN REDIRECT TESTS
 *
 * The post-login `next` parameter is attacker-controlled. Every value below is
 * a real-world bypass pattern; all must be rejected and replaced by the fallback.
 */
describe('safeRedirectPath', () => {
  it('accepts a same-origin absolute path', () => {
    expect(safeRedirectPath('/account')).toBe('/account');
    expect(safeRedirectPath('/bookings/abc123')).toBe('/bookings/abc123');
    expect(safeRedirectPath('/account?tab=orders')).toBe('/account?tab=orders');
  });

  it('rejects absolute URLs to another host', () => {
    expect(safeRedirectPath('https://evil.com')).toBe('/account');
    expect(safeRedirectPath('http://evil.com/phish')).toBe('/account');
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeRedirectPath('//evil.com')).toBe('/account');
    expect(safeRedirectPath('//evil.com/path')).toBe('/account');
  });

  it('rejects javascript: and data: URIs', () => {
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/account');
    expect(safeRedirectPath('data:text/html,<script>alert(1)</script>')).toBe('/account');
  });

  it('rejects backslash-based confusion', () => {
    expect(safeRedirectPath('/\\evil.com')).toBe('/account');
    expect(safeRedirectPath('/..\\..\\evil')).toBe('/account');
  });

  it('rejects control characters used for header smuggling', () => {
    expect(safeRedirectPath('/account\r\nSet-Cookie: a=b')).toBe('/account');
    expect(safeRedirectPath('/account\nLocation: https://evil.com')).toBe('/account');
  });

  it('rejects authority-confusion paths', () => {
    expect(safeRedirectPath('/evil.com@attacker')).toBe('/account');
  });

  it('falls back for empty and non-string input', () => {
    expect(safeRedirectPath(null)).toBe('/account');
    expect(safeRedirectPath(undefined)).toBe('/account');
    expect(safeRedirectPath('')).toBe('/account');
    expect(safeRedirectPath(null, '/login')).toBe('/login');
  });
});

/**
 * ROLE / STATUS NARROWING
 *
 * Stored strings are re-validated before any authorization decision. A tampered
 * or legacy database row must never be able to grant elevated access.
 */
describe('domain narrowing', () => {
  it('recognises exactly the four defined roles', () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
    expect(isRole('SUPERADMIN')).toBe(false);
    expect(isRole('admin')).toBe(false); // case-sensitive on purpose
    expect(isRole('')).toBe(false);
    expect(isRole('ADMIN ')).toBe(false); // trailing whitespace must not pass
  });

  it('recognises exactly the defined booking statuses', () => {
    expect(isBookingStatus('REQUESTED')).toBe(true);
    expect(isBookingStatus('CANCELLED')).toBe(true);
    expect(isBookingStatus('PAID_BY_HACKER')).toBe(false);
    expect(isBookingStatus('paid')).toBe(false);
  });
});