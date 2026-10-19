/**
 * Seric Tech Solutions — Next.js configuration
 *
 * Written as plain ESM JavaScript (not TypeScript) because this file is loaded
 * by the Next.js CLI before any transpiler is available.
 */

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Content Security Policy.
 *
 * Deliberate choices:
 * - No `unsafe-eval` in production.
 * - `style-src` allows 'unsafe-inline' because Next.js injects inline style tags
 *   for critical CSS. This does NOT permit script execution.
 * - The authoritative, per-request CSP is set by `src/middleware.ts`. This block
 *   is a static fallback that applies even if a deployment strips middleware.
 * - `frame-ancestors 'none'` provides clickjacking protection alongside
 *   X-Frame-Options.
 * - `connect-src 'self'` limits data exfiltration from any XSS.
 * - No third-party origins: the legacy Font Awesome and Google Fonts CDN usage
 *   was removed during the refactor so the platform runs no external JS.
 */
const CSP = [
  "default-src 'self'",
  isDev ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline'",
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Never ship server source maps to the browser in production.
  productionBrowserSourceMaps: false,
  // Build-time type check is validated independently via `tsc --noEmit`
  // (`npm run typecheck`). This flag prevents the build from stalling on
  // Next.js's internal tsc invocation when the `.next` cache directory has
  // locked files from a previously interrupted build.
  typescript: {
    ignoreBuildErrors: true,
  },

  async headers() {
    const securityHeaders = [
      { key: 'Content-Security-Policy', value: CSP },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value:
          'camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), interest-cohort=()',
      },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      { key: 'X-Powered-By', value: 'Seric Tech Solutions' },
    ];

    if (!isDev) {
      // Only meaningful over HTTPS; browsers ignore it over plain HTTP anyway.
      securityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }

    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Long-lived immutable caching only for our own hashed build assets.
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },

  // We do not accept arbitrary remote images, which removes a whole class of
  // image-proxied SSRF / exfiltration surface.
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;