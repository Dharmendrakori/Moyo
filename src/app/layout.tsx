import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';

/**
 * ROOT LAYOUT
 *
 * Only global, non-sensitive metadata lives here. No secrets, no internal
 * hostnames, no build metadata.
 *
 * Security headers are applied by `src/middleware.ts` (authoritative,
 * per-request CSP nonce) with a static fallback in `next.config.mjs`.
 */

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: 'MOYO - Service Operations Platform',
    template: '%s | MOYO',
  },
  description:
    'MOYO is a service operations platform for booking, tracking and managing field services across 20 official service categories.',
  applicationName: 'MOYO',
  referrer: 'strict-origin-when-cross-origin',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  formatDetection: { telephone: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // NOTE: deliberately NOT setting maximum-scale/user-scalable=no.
  // Blocking zoom fails WCAG 1.4.4 and harms low-vision users.
  themeColor: '#1e2f63',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Static fallback headers. The middleware sets the authoritative
          per-request CSP with a nonce; this ensures the headers exist even if
          a deployment strips middleware.
        */}
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta name="x-content-type-options" content="nosniff" />
      </head>
      {/*
        `suppressHydrationWarning` mirrors the `<html>` element above: browser
        extensions (password managers, translators, dark-mode injectors) commonly
        add their own attributes/classes to `<html>` and `<body>` after the
        server has rendered. That is a client-only, environment-specific DOM
        mutation this application neither performs nor controls, so it must not
        abort hydration of the whole tree. The attribute is deliberately scoped
        to this element only (React applies it one level deep), so a genuine
        mismatch inside a child component is still reported.
      */}
      <body className="min-h-screen bg-ink-50 text-ink-800 antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}