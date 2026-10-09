/// <reference types="vitest/globals" />
import {
  defaultLandingForRole,
  isAdminPath,
  resolvePostLoginRedirect,
} from '../src/lib/redirect';

/**
 * ROLE-AWARE POST-LOGIN DESTINATION TESTS
 *
 * The `next` parameter is attacker-controlled and the role is server-resolved.
 * These tests pin the current contract:
 * - With NO explicit `next`, BOTH roles default to the public homepage `/`
 *   (never `/account` or `/admin` as an automatic destination).
 * - A safe, explicitly requested `next` is honoured when the role may use it.
 * - `/admin` destinations are only honoured for ADMIN callers; everyone else
 *   falls back to the homepage `/` (never to an admin surface).
 * - Unsafe destinations (external, protocol-relative, credential-bearing)
 *   fall back to the homepage `/`.
 */
describe('resolvePostLoginRedirect', () => {
  it('defaults every role to the public homepage /', () => {
    expect(defaultLandingForRole('ADMIN')).toBe('/');
    expect(defaultLandingForRole('CUSTOMER')).toBe('/');
    expect(defaultLandingForRole('PROVIDER')).toBe('/');
    expect(defaultLandingForRole('TECHNICIAN')).toBe('/');
    expect(defaultLandingForRole(null)).toBe('/');
    expect(defaultLandingForRole(undefined)).toBe('/');
  });

  it('honours a safe, explicitly requested next for the matching role', () => {
    // Admin may reach their account page and the admin console when asked.
    expect(resolvePostLoginRedirect('/account', 'ADMIN')).toBe('/account');
    expect(resolvePostLoginRedirect('/bookings', 'CUSTOMER')).toBe('/bookings');
    expect(resolvePostLoginRedirect('/account', 'CUSTOMER')).toBe('/account');
    expect(resolvePostLoginRedirect('/admin', 'ADMIN')).toBe('/admin');
    expect(resolvePostLoginRedirect('/admin/services', 'ADMIN')).toBe('/admin/services');
  });

  it('defaults both roles to / when no next is supplied', () => {
    expect(resolvePostLoginRedirect(null, 'ADMIN')).toBe('/');
    expect(resolvePostLoginRedirect(null, 'CUSTOMER')).toBe('/');
    expect(resolvePostLoginRedirect(undefined, 'ADMIN')).toBe('/');
    expect(resolvePostLoginRedirect('', 'CUSTOMER')).toBe('/');
  });

  it('never sends a non-ADMIN to an admin destination', () => {
    expect(resolvePostLoginRedirect('/admin', 'CUSTOMER')).toBe('/');
    expect(resolvePostLoginRedirect('/admin/services', 'CUSTOMER')).toBe('/');
    expect(resolvePostLoginRedirect('/admin', null)).toBe('/');
  });

  it('falls back to / for unsafe destinations', () => {
    expect(resolvePostLoginRedirect('https://evil.com', 'CUSTOMER')).toBe('/');
    expect(resolvePostLoginRedirect('//evil.com', 'CUSTOMER')).toBe('/');
    expect(resolvePostLoginRedirect('https://evil.com', 'ADMIN')).toBe('/');
    expect(resolvePostLoginRedirect('//evil.com/path', 'ADMIN')).toBe('/');
  });

  it('rejects credential-bearing destinations for every role', () => {
    expect(resolvePostLoginRedirect('/account?password=x', 'CUSTOMER')).toBe('/');
    expect(resolvePostLoginRedirect('/admin?token=x', 'ADMIN')).toBe('/');
  });

  it('classifies admin paths', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/services')).toBe(true);
    expect(isAdminPath('/account')).toBe(false);
    expect(isAdminPath('/administrator')).toBe(false);
  });
});
