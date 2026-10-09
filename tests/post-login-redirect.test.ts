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
 * These tests pin the contract fixed for the `/account` 404:
 * - ADMIN defaults to `/admin`; everyone else defaults to `/account`.
 * - A safe `next` is honoured when the role may use it.
 * - `/admin` is never handed to a non-ADMIN caller.
 * - Unsafe destinations fall back to the role's landing page.
 */
describe('resolvePostLoginRedirect', () => {
  it('defaults ADMIN to /admin and others to /account', () => {
    expect(defaultLandingForRole('ADMIN')).toBe('/admin');
    expect(defaultLandingForRole('CUSTOMER')).toBe('/account');
    expect(defaultLandingForRole('PROVIDER')).toBe('/account');
    expect(defaultLandingForRole('TECHNICIAN')).toBe('/account');
    expect(defaultLandingForRole(null)).toBe('/account');
    expect(defaultLandingForRole(undefined)).toBe('/account');
  });

  it('honours a safe next for the matching role', () => {
    expect(resolvePostLoginRedirect('/bookings', 'CUSTOMER')).toBe('/bookings');
    expect(resolvePostLoginRedirect('/admin', 'ADMIN')).toBe('/admin');
    expect(resolvePostLoginRedirect('/admin/services', 'ADMIN')).toBe('/admin/services');
  });

  it('never sends a non-ADMIN to an admin destination', () => {
    expect(resolvePostLoginRedirect('/admin', 'CUSTOMER')).toBe('/account');
    expect(resolvePostLoginRedirect('/admin/services', 'CUSTOMER')).toBe('/account');
    expect(resolvePostLoginRedirect('/admin', null)).toBe('/account');
  });

  it('falls back to the role landing page for unsafe destinations', () => {
    expect(resolvePostLoginRedirect('https://evil.com', 'CUSTOMER')).toBe('/account');
    expect(resolvePostLoginRedirect('//evil.com', 'CUSTOMER')).toBe('/account');
    expect(resolvePostLoginRedirect('https://evil.com', 'ADMIN')).toBe('/admin');
    expect(resolvePostLoginRedirect('//evil.com/path', 'ADMIN')).toBe('/admin');
    expect(resolvePostLoginRedirect(null, 'CUSTOMER')).toBe('/account');
    expect(resolvePostLoginRedirect(null, 'ADMIN')).toBe('/admin');
    expect(resolvePostLoginRedirect('', 'CUSTOMER')).toBe('/account');
  });

  it('rejects credential-bearing destinations for every role', () => {
    expect(resolvePostLoginRedirect('/account?password=x', 'CUSTOMER')).toBe('/account');
    expect(resolvePostLoginRedirect('/admin?token=x', 'ADMIN')).toBe('/admin');
  });

  it('classifies admin paths', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/services')).toBe(true);
    expect(isAdminPath('/account')).toBe(false);
    expect(isAdminPath('/administrator')).toBe(false);
  });
});
