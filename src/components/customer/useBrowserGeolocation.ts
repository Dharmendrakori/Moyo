'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * BROWSER GEOLOCATION + REVERSE GEOCODING
 *
 * Reusable hook used by both the saved-address form (AccountManager) and the
 * service-location step (BookingWizard). It is deliberately user-initiated:
 * nothing runs on mount, no permission prompt fires until `detect()` is called.
 *
 * Reverse geocoding goes through OpenStreetMap Nominatim (free, no API key).
 * See https://operations.osmfoundation.org/policies/nominatim/ for usage limits:
 *   - max ~1 request/second per client,
 *   - a descriptive User-Agent is recommended (browsers set their own),
 *   - attribution is required wherever results are shown.
 *
 * We never log coordinates or full addresses.
 */
export type GeolocationAddress = {
  line1: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  landmark?: string;
};

export type GeolocationStatus = 'idle' | 'loading' | 'success' | 'error';

export type GeolocationFailureCode =
  | 'unsupported'
  | 'denied'
  | 'timeout'
  | 'unavailable'
  | 'failed'
  | 'aborted';

export type GeolocationError = {
  code: GeolocationFailureCode;
  message: string;
};

export function useBrowserGeolocation() {
  const [status, setStatus] = useState<GeolocationStatus>('idle');
  const [error, setError] = useState<GeolocationError | null>(null);
  const inFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const detect = useCallback(async (): Promise<GeolocationAddress | null> => {
    // Prevent repeated concurrent requests.
    if (inFlight.current) return null;
    inFlight.current = true;
    setStatus('loading');
    setError(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        throw { code: 'unsupported' as const, message: 'Your browser does not support location detection.' };
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });

      if (abort.signal.aborted) return null;

      const { latitude, longitude } = position.coords;

      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`,
        { signal: abort.signal, headers: { 'Accept-Language': 'en' } },
      );

      if (!res.ok) {
        throw { code: 'failed' as const, message: 'Could not look up your address. Please enter it manually.' };
      }

      const data = (await res.json()) as { address?: Record<string, string> } | null;
      const addr = data?.address ?? {};

      // Normalise incomplete results safely; never fabricate missing fields.
      const houseNumber = addr.house_number ? String(addr.house_number).trim() : '';
      const road = addr.road ?? addr.pedestrian ?? addr.footway ?? addr.path ?? '';
      const line1 = [houseNumber, road].filter(Boolean).join(' ').trim() || road;

      const result: GeolocationAddress = {
        line1,
        area:
          addr.suburb ??
          addr.neighbourhood ??
          addr.quarter ??
          addr.village ??
          addr.hamlet ??
          '',
        city:
          addr.city ??
          addr.town ??
          addr.municipality ??
          addr.city_district ??
          '',
        state: addr.state ?? '',
        pincode: addr.postcode ?? '',
        landmark: addr.amenity ?? addr.tourism ?? addr.historic ?? undefined,
      };

      if (abort.signal.aborted) return null;

      setStatus('success');
      return result;
    } catch (err: unknown) {
      if (abort.signal.aborted) {
        setStatus('idle');
        return null;
      }

      const geoErr = err as { code?: number | string; message?: string; name?: string };
      let code: GeolocationFailureCode = 'failed';
      let message = 'Could not detect your location. Please enter it manually.';

      if (geoErr?.code === 1) {
        code = 'denied';
        message = 'Location permission denied. Please enable it in your browser settings.';
      } else if (geoErr?.code === 2) {
        code = 'unavailable';
        message = 'Your location is currently unavailable.';
      } else if (geoErr?.code === 3) {
        code = 'timeout';
        message = 'Location request timed out. Please try again.';
      } else if (geoErr?.code === 'unsupported') {
        code = 'unsupported';
        message = geoErr.message ?? message;
      } else if (geoErr?.code === 'failed' || geoErr?.code === 'geocode_failed') {
        code = 'failed';
        message = geoErr.message ?? 'Could not look up your address from your location. Please enter it manually.';
      } else if (geoErr?.name === 'AbortError') {
        code = 'aborted';
        message = 'Location detection was cancelled.';
      }

      setError({ code, message });
      setStatus('error');
      return null;
    } finally {
      inFlight.current = false;
      abortRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { detect, status, error, loading: status === 'loading', reset };
}
