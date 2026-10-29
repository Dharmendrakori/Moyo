import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Server-side reverse-geocoding proxy for OpenStreetMap Nominatim.
 *
 * The browser cannot call Nominatim directly: our strict CSP sets
 * `connect-src 'self'`, and Nominatim does not emit
 * `Access-Control-Allow-Origin` headers, so a cross-origin fetch from the browser
 * would be blocked by both CSP and CORS. Proxying through our own origin avoids
 * both problems with no new dependencies.
 *
 * Nominatim usage policy: ~1 request/second per client, descriptive
 * User-Agent required. A simple identifying User-Agent is sufficient; no URL
 * or email is strictly required by the service, but including one is recommended.
 */
const querySchema = z.object({
  lat: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  lon: z.string().regex(/^-?\d+(?:\.\d+)?$/),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    lat: searchParams.get('lat'),
    lon: searchParams.get('lon'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_PARAMETERS' },
      { status: 400 }
    );
  }

  const { lat, lon } = parsed.data;

  try {
    console.error('[geocode/reverse] Starting Nominatim request, lat=', lat, 'lon=', lon);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`,
      {
        headers: {
          'Accept-Language': 'en',
          // Nominatim requests a descriptive User-Agent; browsers set their own,
          // but server-side we must provide one explicitly. A simple identifier
          // is sufficient; the URL/email format is not strictly required.
          'User-Agent': 'Moyo/1.0',
        },
      },
    );
    console.error('[geocode/reverse] Nominatim response status:', res.status);

    if (!res.ok) {
      const resText = await res.text().catch(() => 'unknown');
      console.error(
        '[geocode/reverse] Nominatim not ok:',
        res.status,
        resText
      );
      return NextResponse.json(
        { error: 'GEOCODE_FAILED' },
        { status: 502 }
      );
    }

    const data = await res.json();
    console.error('[geocode/reverse] Nominatim success, returning data');
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    console.error(
      '[geocode/reverse] fetch failed:',
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: 'GEOCODE_FAILED' },
      { status: 502 }
    );
  }
}