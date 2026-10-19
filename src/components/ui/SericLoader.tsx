import { cn } from '@/lib/format';

/**
 * SERIC TECH LOADER (Phase 2.2)
 *
 * Reusable loading indicator with two variants:
 * - `brand`  — larger loading states. Rounded navy tile with the Seric Tech
 *   symbol mark, gentle opacity/scale pulse plus an optional soft blue glow.
 * - `pixels` — inline / compact loading. A row of small squares inspired by
 *   the pixelated brand icon (squares only, no letterform), sequenced with
 *   opacity + scale + translate transitions.
 *
 * Accessibility:
 * - Renders `role="status"` with an `aria-label` and visually-hidden text so
 *   screen readers announce it.
 * - All animation is CSS keyframes gated behind
 *   `@media (prefers-reduced-motion: reduce)` in `globals.css`, so users who
 *   ask for less motion see a static indicator.
 * - No layout shift: the host is `inline-flex` with a fixed size derived from
 *   the `size` prop.
 *
 * Works on light and dark surfaces via `currentColor`-friendly tones plus an
 * explicit `tone` prop (`auto` inherits surrounding text colour).
 */

export type SericLoaderVariant = 'brand' | 'pixels';
export type SericLoaderSize = 'xs' | 'sm' | 'md' | 'lg';

export type SericLoaderProps = {
  variant?: SericLoaderVariant;
  size?: SericLoaderSize;
  /** Accessible label announced to screen readers. */
  label?: string;
  className?: string;
  /** Extra glow for the branded variant on dark headers. */
  glow?: boolean;
};

const WRAP_SIZE: Record<SericLoaderSize, string> = {
  xs: 'h-5',
  sm: 'h-6',
  md: 'h-10',
  lg: 'h-14',
};

const BRAND_TILE: Record<SericLoaderSize, string> = {
  xs: 'h-5 w-5 rounded-md text-[10px]',
  sm: 'h-6 w-6 rounded-md text-xs',
  md: 'h-10 w-10 rounded-xl text-base',
  lg: 'h-14 w-14 rounded-2xl text-2xl',
};

const PIXEL_DOT: Record<SericLoaderSize, string> = {
  xs: 'h-1 w-1 rounded-[1px]',
  sm: 'h-1.5 w-1.5 rounded-[2px]',
  md: 'h-2 w-2 rounded-[2px]',
  lg: 'h-2.5 w-2.5 rounded-[3px]',
};

const PIXEL_GAP: Record<SericLoaderSize, string> = {
  xs: 'gap-1',
  sm: 'gap-1',
  md: 'gap-1.5',
  lg: 'gap-1.5',
};

export function SericLoader({
  variant = 'pixels',
  size = 'md',
  label = 'Loading',
  className,
  glow = false,
}: SericLoaderProps) {
  if (variant === 'brand') {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={label}
        className={cn('inline-flex items-center gap-3', WRAP_SIZE[size], className)}
      >
        <span
          aria-hidden
          className={cn(
            'seric-loader-brand grid shrink-0 place-items-center bg-night-950 font-display font-semibold text-gold-400',
            'ring-1 ring-inset ring-white/15',
            BRAND_TILE[size],
            glow && 'seric-loader-glow',
          )}
        >
          {/* Seric Tech symbol echoes the header brand tile; pixel squares carry the motion. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[55%] w-[55%]"
          >
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
          </svg>
        </span>
        <span aria-hidden className={cn('flex items-center', PIXEL_GAP[size])}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn('seric-loader-pixel bg-brand-600', PIXEL_DOT[size])}
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn('inline-flex items-center', PIXEL_GAP[size], className)}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          aria-hidden
          className={cn('seric-loader-pixel bg-brand-600', PIXEL_DOT[size])}
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Inline spinner for buttons / local actions. Keeps the label readable while
 * the request is in flight and collapses gracefully under reduced motion.
 */
export function SericInlineSpinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('seric-inline-spinner h-3.5 w-3.5 shrink-0 rounded-full', className)}
    />
  );
}

/**
 * Skeleton booking cards for the /bookings loading state. Pure presentation —
 * no data, no business logic.
 */
export function BookingCardSkeleton() {
  return (
    <div
      aria-hidden
      className="rounded-3xl border border-ink-200 bg-white p-6 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
        </div>
        <div className="skeleton h-6 w-20 rounded" />
      </div>
      <div className="mt-4 space-y-2 border-t border-ink-100 pt-3">
        <div className="skeleton h-3 w-1/3 rounded" />
        <div className="skeleton h-3 w-1/4 rounded" />
      </div>
    </div>
  );
}
