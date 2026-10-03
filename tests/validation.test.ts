/// <reference types="vitest/globals" />
import {
  BUDGET_CEILING_PAISE,
  BUDGET_FLOOR_PAISE,
  createBookingSchema,
  materialOrderSchema,
  phoneSchema,
  pincodeSchema,
  registerSchema,
} from '../src/lib/validation';

/**
 * VALIDATION TESTS
 *
 * These mirror the client-side rules but, more importantly, assert that
 * dangerous input is REJECTED rather than coerced.
 */

describe('input validation', () => {
  describe('phone numbers', () => {
    it('normalizes Indian numbers to 10 digits', () => {
      expect(phoneSchema.parse('+91 98765 43210')).toBe('9876543210');
      expect(phoneSchema.parse('919876543210')).toBe('9876543210');
      expect(phoneSchema.parse('098765-43210')).toBe('9876543210');
      expect(phoneSchema.parse('(98765) 43210')).toBe('9876543210');
    });

    it('rejects invalid numbers', () => {
      expect(phoneSchema.safeParse('1234567890').success).toBe(false); // bad prefix
      expect(phoneSchema.safeParse('98765').success).toBe(false); // too short
      expect(phoneSchema.safeParse('98765432101').success).toBe(false); // too long
      expect(phoneSchema.safeParse('abcdefghij').success).toBe(false);
      expect(phoneSchema.safeParse('98765abcde').success).toBe(false);
    });
  });

  describe('PIN codes', () => {
    it('accepts a valid 6-digit PIN', () => {
      expect(pincodeSchema.parse('462030')).toBe('462030');
    });

    it('rejects malformed PINs', () => {
      expect(pincodeSchema.safeParse('012345').success).toBe(false); // leading zero
      expect(pincodeSchema.safeParse('46203').success).toBe(false);
      expect(pincodeSchema.safeParse('4620301').success).toBe(false);
      expect(pincodeSchema.safeParse('46 030').success).toBe(false);
    });
  });

  describe('registration', () => {
    const valid = {
      name: 'Rahul Sharma',
      email: 'Rahul@Example.COM',
      phone: '9876543210',
      password: 'Str0ng!Passphrase#2024',
      confirmPassword: 'Str0ng!Passphrase#2024',
    };

    it('normalizes the email and accepts a strong password', () => {
      expect(registerSchema.parse(valid).email).toBe('rahul@example.com');
    });

    it('requires the passwords to match', () => {
      expect(
        registerSchema.safeParse({ ...valid, confirmPassword: 'Different!123' }).success,
      ).toBe(false);
    });

    it('rejects weak passwords', () => {
      const weak = [
        'short1!A',
        'alllowercase!123',
        'NoNumbersHere!',
        'NoSymbols12345',
        'PasswordPassword123',
      ];
      for (const password of weak) {
        expect(
          registerSchema.safeParse({ ...valid, password, confirmPassword: password }).success,
          `password "${password}" should be rejected`,
        ).toBe(false);
      }
    });

    it('does not accept a role field (mass-assignment defence)', () => {
      expect(registerSchema.safeParse({ ...valid, role: 'ADMIN' }).success).toBe(false);
    });
  });

  describe('booking creation', () => {
    const base = {
      serviceId: 'cm1234567890123456789012',
      charging: 'VISIT_CHARGE',
      mode: 'INSTANT',
      address: {
        line1: 'Plot 14, Royal Market',
        area: 'Royal Market',
        city: 'Bhopal',
        state: 'Madhya Pradesh',
        pincode: '462030',
      },
      contactName: 'Rahul Sharma',
      contactPhone: '9876543210',
    };

    it('accepts a minimal valid booking', () => {
      expect(createBookingSchema.safeParse(base).success).toBe(true);
    });

    it('rejects an unknown charging option', () => {
      expect(createBookingSchema.safeParse({ ...base, charging: 'FREE' }).success).toBe(false);
      expect(createBookingSchema.safeParse({ ...base, charging: 'visit_charge' }).success).toBe(false);
    });

    it('rejects an unknown booking mode', () => {
      expect(createBookingSchema.safeParse({ ...base, mode: 'WHENEVER' }).success).toBe(false);
    });

    it('requires both bounds for a customer budget', () => {
      expect(
        createBookingSchema.safeParse({ ...base, charging: 'CUSTOMER_BUDGET' }).success,
      ).toBe(false);
      expect(
        createBookingSchema.safeParse({
          ...base,
          charging: 'CUSTOMER_BUDGET',
          budgetMin: 50_000,
        }).success,
      ).toBe(false);
    });

    it('rejects a budget where minimum exceeds maximum', () => {
      expect(
        createBookingSchema.safeParse({
          ...base,
          charging: 'CUSTOMER_BUDGET',
          budgetMin: 200_000,
          budgetMax: 100_000,
        }).success,
      ).toBe(false);
    });

    it('rejects a budget outside the permitted bounds', () => {
      expect(
        createBookingSchema.safeParse({
          ...base,
          charging: 'CUSTOMER_BUDGET',
          budgetMin: 1,
          budgetMax: 200_000,
        }).success,
      ).toBe(false);

      expect(
        createBookingSchema.safeParse({
          ...base,
          charging: 'CUSTOMER_BUDGET',
          budgetMin: 50_000,
          budgetMax: BUDGET_CEILING_PAISE + 1,
        }).success,
      ).toBe(false);
    });

    it('accepts a valid in-range budget', () => {
      expect(
        createBookingSchema.safeParse({
          ...base,
          charging: 'CUSTOMER_BUDGET',
          budgetMin: BUDGET_FLOOR_PAISE,
          budgetMax: 5_000_00,
        }).success,
      ).toBe(true);
    });

    it('requires a future date for a scheduled booking', () => {
      const past = new Date(Date.now() - 86_400_000);
      expect(
        createBookingSchema.safeParse({ ...base, mode: 'SCHEDULED', scheduledFor: past }).success,
      ).toBe(false);
    });

    it('rejects a schedule beyond 90 days', () => {
      const far = new Date(Date.now() + 200 * 86_400_000);
      expect(
        createBookingSchema.safeParse({ ...base, mode: 'SCHEDULED', scheduledFor: far }).success,
      ).toBe(false);
    });

    it('rejects unknown top-level fields (mass-assignment defence)', () => {
      // A malicious client trying to set privileged fields.
      expect(
        createBookingSchema.safeParse({
          ...base,
          customerId: 'cmattacker',
          providerId: 'cmattacker',
          status: 'PAID',
          quotedPaise: 1,
        }).success,
      ).toBe(false);
    });

    it('rejects an oversized description', () => {
      expect(
        createBookingSchema.safeParse({ ...base, description: 'x'.repeat(2000) }).success,
      ).toBe(false);
    });
  });

  describe('material orders', () => {
    const base = {
      address: {
        line1: 'Plot 14',
        area: 'Royal Market',
        city: 'Bhopal',
        state: 'MP',
        pincode: '462030',
      },
      contactName: 'Rahul',
      contactPhone: '9876543210',
      installationRequested: false,
    };
    const id = 'cm1234567890123456789012';

    it('rejects an empty cart', () => {
      expect(materialOrderSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    });

    it('rejects a non-positive or excessive quantity', () => {
      expect(
        materialOrderSchema.safeParse({ ...base, items: [{ materialId: id, quantity: 0 }] }).success,
      ).toBe(false);
      expect(
        materialOrderSchema.safeParse({ ...base, items: [{ materialId: id, quantity: 101 }] }).success,
      ).toBe(false);
      expect(
        materialOrderSchema.safeParse({ ...base, items: [{ materialId: id, quantity: 2 }] }).success,
      ).toBe(true);
    });
  });
});