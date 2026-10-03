import type { NextConfig } from 'next';

/**
 * Content Security Policy.
 *
 * Notes on deliberate choices:
 * - No `unsafe-eval`. Next.js production build does not require it.
 * - `style-src` allows 'unsafe-inline' because Next.js injects inline style tags
 *   for critical CSS and the admin layout sets CSS custom properties inline.
 *   This does NOT permit script execution.
 * - `script-src` is strict ('self' + nonce path via middleware). Next.js needs
 *   'unsafe-inline' fallback ONLY in development for the dev overlay; in
 *   production the middleware attaches a per-request nonce.
 * - `frame-ancestors 'none'` provides clickjacking protection in addition to
 *   X-Frame-Options so that modern browsers enforce it.
 * - connect-src restricted to 'self' - no arbitrary outbound endpoints from the
 *   browser, which reduces exfiltration surface of any XSS.
 */
const isDev = process.env.NODE_ENV !== 'production';

const cspDirectives = [
  "default-src 'self'",
  // Development needs eval for the React Fast Refresh runtime.
  isDev ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'" : "script-src 'self' 'nonce-{NONCE}' 'strict-dynamic'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // No third-party origins. The legacy Font Awesome / Google Fonts CDN usage was
  // removed during the refactor so the platform has no external JS dependency.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

/**
 * Builds the header set. `nonce` is supplied by middleware for script-src.
 */
export function buildSecurityHeaders(nonce?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': cspDirectives.replace('{NONCE}', nonce ?? ''),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), interest-cohort=()',
    'X-DNS-Prefetch-Control': 'off',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    // Never leak the framework/host stack.
    'X-Powered-By': 'Moyo',
  };

  if (!isDev) {
    // Only meaningful over HTTPS; sending it over plain HTTP is ignored by
    // browsers anyway, but we gate it so local http development is not broken.
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  }

  return headers;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Never expose the server error/stack details to the client in production.
  productionBrowserSourceMaps: false,

  // Uploaded/attachment files are served by an authorized route handler, never
  // statically, so they cannot be used as an executable or public web root.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildSecurityHeaders(),
      },
      {
        // Long-lived immutable caching only for our own hashed build assets.
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // Never cache authenticated HTML.
        source: '/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
    ];
  },

  eslint: {
    dirs: ['src'],
  },

  // Server Actions / images: we do not accept arbitrary remote images, which
  // removes a whole SSRF and image-proxied-exfiltration class.
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;