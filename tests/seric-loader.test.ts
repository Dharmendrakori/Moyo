/// <reference types="vitest/globals" />
import { vi } from 'vitest';
import type { ImgHTMLAttributes } from 'react';

/** Substitute props for the stubbed `next/image` component. */
type ImageStubProps = Pick<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'alt' | 'width' | 'height' | 'className'
>;

vi.mock('next/image', () => ({
  default: function ImageStub(props: ImageStubProps) {
    return h('img', {
      src: String(props.src),
      alt: String(props.alt ?? ''),
      width: Number(props.width),
      height: Number(props.height),
      className: props.className,
    });
  },
  Image: function ImageStub(props: ImageStubProps) {
    return h('img', {
      src: String(props.src),
      alt: String(props.alt ?? ''),
      width: Number(props.width),
      height: Number(props.height),
      className: props.className,
    });
  },
  isStaticRequire: () => false,
  isStaticImage: () => false,
}));

vi.mock('next/dist/client/image-component', () => ({
  Image: function ImageStub(props: ImageStubProps) {
    return h('img', {
      src: String(props.src),
      alt: String(props.alt ?? ''),
      width: Number(props.width),
      height: Number(props.height),
      className: props.className,
    });
  },
}));

/**
 * SERIC LOADER REGRESSION TESTS (Phase 2.4)
 *
 * Pins the fix for the invisible loader bug:
 *
 *  - loader markup must carry `role="status"`, non-zero dimensions, the
 *    approved Seric logo (never the legacy MOYO bolt) and the animation
 *    class names;
 *  - `globals.css` must actually DEFINE those classes and keyframes (the
 *    original bug: classes existed only in JSX, so the loader rendered
 *    static/invisible markup);
 *  - the reduced-motion block must keep a fully visible static indicator;
 *  - `loading.tsx` must mount the full-page loader immediately, with no
 *    artificial delay state;
 *  - the booking wizard must connect its inline/overlay states to the real
 *    `loadingQuote` / `submitting` lifecycles (try/finally resets).
 *
 * Rendering uses `react-dom/server` with `next/image` stubbed. Elements are
 * built with `createElement` because vitest's include pattern is `.ts` (no
 * JSX transform in this file). The loader is deliberately hook-free so it
 * can paint from server-rendered boundary HTML before hydration.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BookingCardSkeleton,
  SericFullPageLoader,
  SericInlineSpinner,
  SericLoader,
  SericOverlayLoader,
} from '../src/components/ui/SericLoader';
import RootLoading from '../src/app/loading';
import CustomerLoading from '../src/app/(customer)/loading';

const LOGO_SRC = '/brand/seric-tech-solutions-logo.png';

/** Legacy MOYO bolt path - must never appear in the loader. */
const LEGACY_BOLT = 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z';

function render(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

describe('SericFullPageLoader (route fallback)', () => {
  const html = render(h(SericFullPageLoader, { label: 'Loading' }));

  it('is a labelled live region', () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Loading…');
  });

  it('renders the approved Seric logo with non-zero dimensions', () => {
    expect(html).toContain(LOGO_SRC);
    expect(html).toMatch(/width="112"/);
    expect(html).toMatch(/height="112"/);
    expect(html).not.toContain(LEGACY_BOLT);
  });

  it('covers the viewport as a fixed branded screen', () => {
    expect(html).toContain('fixed inset-0');
    expect(html).toContain('bg-night-950');
  });

  it('includes the animated pixel motif in brand blue and logo cyan', () => {
    expect(html).toContain('seric-loader-pixel');
    expect(html).toContain('bg-brand-500');
    expect(html).toContain('bg-brand-cyan');
    // Staggered per-dot delays drive the sequential wave.
    expect(html).toContain('animation-delay');
  });
});

describe('SericLoader variants', () => {
  it('brand variant shows the logo tile, pulse class and pixel dots', () => {
    const html = render(
      h(SericLoader, { variant: 'brand', size: 'lg', glow: true, label: 'Loading Seric' }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading Seric"');
    expect(html).toContain(LOGO_SRC);
    expect(html).toContain('seric-loader-brand');
    expect(html).toContain('seric-loader-glow');
    expect(html).toContain('seric-loader-pixel');
    expect(html).not.toContain(LEGACY_BOLT);
  });

  it('pixels variant renders five staggered squares and sr-only label', () => {
    const html = render(h(SericLoader, { variant: 'pixels', size: 'md' }));
    expect(html).toContain('role="status"');
    expect((html.match(/seric-loader-pixel/g) ?? []).length).toBe(5);
    expect(html).toContain('sr-only');
  });
});

describe('SericInlineSpinner (quote / submit states)', () => {
  const html = render(h(SericInlineSpinner, {}));

  it('has non-zero size and a static visible ring even without animation', () => {
    expect(html).toContain('seric-inline-spinner');
    expect(html).toContain('h-3.5');
    expect(html).toContain('w-3.5');
    expect(html).toContain('rounded-full');
    // Static fallback: a brand-blue ring with a transparent head.
    expect(html).toContain('border-2');
    expect(html).toContain('border-brand-500');
    expect(html).toContain('border-t-transparent');
  });
});

describe('SericOverlayLoader (blocking operations)', () => {
  const html = render(h(SericOverlayLoader, { label: 'Placing your booking' }));

  it('dims the screen and announces through the inner brand loader once', () => {
    expect(html).toContain('fixed inset-0');
    expect(html).toContain('bg-night-950/75');
    expect(html).toContain('role="status"');
    expect(html).toContain(LOGO_SRC);
    expect(html).toContain('Placing your booking…');
    // Exactly one status region: the inner loader owns the announcement.
    expect((html.match(/role="status"/g) ?? []).length).toBe(1);
  });
});

describe('route loading boundary (src/app/loading.tsx)', () => {
  const html = render(h(RootLoading, {}));

  it('mounts the full-page Seric loader immediately, with no delay gate', () => {
    const source = readFileSync(path.join(process.cwd(), 'src', 'app', 'loading.tsx'), 'utf8');
    // The original bug introduced a setTimeout/useState delay gate that could
    // unmount before ever showing the loader.
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain("'use client'");
    expect(html).toContain(LOGO_SRC);
    expect(html).toContain('role="status"');
    expect(html).toContain('fixed inset-0');
  });
});

describe('customer route loading boundary (src/app/(customer)/loading.tsx)', () => {
  const html = render(h(CustomerLoading, {}));

  it('mounts the full-page Seric loader immediately, with no delay gate', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src', 'app', '(customer)', 'loading.tsx'),
      'utf8',
    );
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain("'use client'");
    expect(html).toContain(LOGO_SRC);
    expect(html).toContain('role="status"');
    expect(html).toContain('fixed inset-0');
  });
});

describe('globals.css defines the loader animation primitives', () => {
  const css = readFileSync(path.join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');

  it('defines every class the JSX references, with keyframes', () => {
    for (const cls of [
      'seric-loader-pixel',
      'seric-loader-brand',
      'seric-loader-glow',
      'seric-inline-spinner',
    ]) {
      expect(css, `${cls} rule`).toContain(`.${cls} {`);
    }
    for (const kf of [
      'seric-pixel-wave',
      'seric-brand-pulse',
      'seric-glow-breathe',
      'seric-spin',
    ]) {
      expect(css, `${kf} keyframes`).toContain(`@keyframes ${kf}`);
    }
  });

  it('keeps a fully visible static indicator under prefers-reduced-motion', () => {
    const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.seric-loader-pixel');
    expect(block).toContain('animation: none !important');
    expect(block).toContain('opacity: 1 !important');
  });

  it('exposes the logo-cyan token used by the pixel motif', () => {
    expect(css).toContain('--color-brand-cyan');
  });
});

describe('BookingWizard loading-state lifecycle', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src', 'components', 'customer', 'BookingWizard.tsx'),
    'utf8',
  );

  it('connects the inline spinner to the real quote and submit states', () => {
    expect(source).toMatch(/\{loadingQuote && \(/);
    expect(source).toMatch(/\{submitting \? \(/);
    expect(source).toContain('<SericInlineSpinner />');
  });

  it('shows the blocking overlay only while submitting', () => {
    expect(source).toContain('{submitting && <SericOverlayLoader');
  });

  it('restores both loading flags in finally, on success and failure alike', () => {
    expect(source).toMatch(/finally \{\s*setLoadingQuote\(false\)/);
    expect(source).toMatch(/finally \{\s*setSubmitting\(false\)/);
  });

  it('guards against duplicate submissions', () => {
    expect(source).toContain('if (submitting) return;');
  });
});

describe('BookingCardSkeleton still renders', () => {
  it('is a non-interactive skeleton block', () => {
    const html = render(h(BookingCardSkeleton, {}));
    expect(html).toContain('aria-hidden');
    expect(html).toContain('skeleton');
  });
});
