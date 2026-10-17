'use client';

import { useLayoutEffect, useRef } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

/**
 * SCROLL-DRIVEN SVG JOURNEY LINE
 *
 * A reusable section spine that draws itself in sync with the user's scroll
 * position, threading through milestone markers that light up as the line
 * reaches them. Pure React + SVG - no animation libraries.
 *
 * Mechanics:
 *  - the path carries `pathLength="1"` so a single normalised
 *    stroke-dashoffset (1 = undrawn, 0 = fully drawn) maps scroll progress to
 *    drawing progress between zero and one;
 *  - scroll progress is computed from the section's own bounding box, so it
 *    works on load, on refresh, on deep links and during rapid scrolling;
 *  - updates are rAF-throttled and write straight to the DOM via refs -
 *    no React state changes per scroll event;
 *  - the curve is measured from the real milestone dot positions after
 *    layout (and on resize) so the line always connects the actual content
 *    points at every viewport, with no clipping or layout shift;
 *  - `prefers-reduced-motion` renders the complete static line with all
 *    milestones active and installs no listeners. Without JavaScript the
 *    line stays undrawn but every milestone's text remains fully readable -
 *    the animation is decoration, never the content.
 */

export type JourneyStep = {
  icon: IconName;
  title: string;
  description: string;
};

/** viewBox is stretched to the column (preserveAspectRatio="none"), so these
 * are fractions of the column width: the line weaves gently between two
 * lanes and the milestone dots sit exactly on it. */
const LANE_A = 38;
const LANE_B = 82;
const VIEW_W = 120;
const Y_PAD = 40;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function JourneyLine({
  steps,
  className,
}: {
  steps: JourneyStep[];
  className?: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const trackRef = useRef<SVGPathElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const dotRefs = useRef<HTMLSpanElement[]>([]);

  // Measured geometry lives in a ref, never in state: resizes re-measure,
  // scrolls only rewrite the dashoffset and milestone classes.
  useLayoutEffect(() => {
    const list = listRef.current;
    const svg = svgRef.current;
    const track = trackRef.current;
    const line = lineRef.current;
    if (!list || !svg || !track || !line) return;

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const dots = dotRefs.current.filter((d): d is HTMLSpanElement => Boolean(d));

    /** Re-measure dot centers and rebuild the curve in viewBox units. */
    const layout = () => {
      const listRect = list.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      if (listRect.height === 0 || svgRect.width === 0) return;
      const scaleX = VIEW_W / svgRect.width;
      const scaleY = 1000 / listRect.height;
      const points = dots.map((dot) => {
        const r = dot.getBoundingClientRect();
        return {
          x: (r.left + r.width / 2 - svgRect.left) * scaleX,
          y: (r.top + r.height / 2 - listRect.top) * scaleY,
        };
      });
      if (points.length >= 2) {
        const d = buildPath(points);
        track.setAttribute('d', d);
        line.setAttribute('d', d);
      }
    };

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = list.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // The line starts drawing when the section top crosses 85% of the
      // viewport and completes as its bottom crosses 45% - progress is
      // driven purely by the section's own position, never hijacking scroll.
      const start = vh * 0.85;
      const end = vh * 0.45;
      const progress = clamp01((start - rect.top) / Math.max(1, rect.height + start - end));
      line.style.strokeDashoffset = String(1 - progress);
      const last = Math.max(1, dots.length - 1);
      dots.forEach((dot, i) => {
        dot.closest('.journey-step')?.classList.toggle('is-active', progress >= i / last);
      });
    };

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    if (reduced) {
      // Static, complete line: no listeners, every milestone emphasised.
      layout();
      line.style.strokeDashoffset = '0';
      for (const dot of dots) dot.closest('.journey-step')?.classList.add('is-active');
      return;
    }

    // Initial synchronous pass inside useLayoutEffect: measured before paint,
    // so no stale straight-line frame is ever visible.
    layout();
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      layout();
      onScroll();
    });
    ro.observe(list);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [steps.length]);

  // Pre-measurement fallback: a straight weave through the nominal lanes, so
  // the decorative track looks sane even before the first layout pass (and
  // for no-JS visitors, for whom the track is the only thing rendered).
  const fallbackPath = buildPath(
    Array.from({ length: steps.length }, (_, i) => ({
      x: i % 2 === 0 ? LANE_A : LANE_B,
      y: Y_PAD + (i * (1000 - 2 * Y_PAD)) / Math.max(1, steps.length - 1),
    })),
  );

  return (
    <ol ref={listRef} className={`journey relative ${className ?? ''}`}>
      {/* Decorative spine - hidden from assistive tech. */}
      <svg
        ref={svgRef}
        className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-24"
        viewBox={`0 0 ${VIEW_W} 1000`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          ref={trackRef}
          className="journey-track"
          d={fallbackPath}
          fill="none"
          pathLength={1}
          vectorEffect="non-scaling-stroke"
        />
        <path
          ref={lineRef}
          className="journey-path"
          d={fallbackPath}
          fill="none"
          pathLength={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {steps.map((step, i) => (
        <li
          key={step.title}
          className="journey-step relative grid grid-cols-[4rem_1fr] gap-3 py-6 sm:grid-cols-[6rem_1fr] sm:gap-5"
        >
          <div className="relative">
            <span
              ref={(el) => {
                if (el) dotRefs.current[i] = el;
              }}
              className={`journey-dot absolute top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full ${
                i % 2 === 0 ? 'left-[32%]' : 'left-[68%]'
              }`}
            >
              <Icon name={step.icon} size={18} />
            </span>
          </div>
          <div className="pt-1.5 sm:pt-3">
            <h3 className="journey-title text-sm font-semibold text-ink-500 sm:text-base">
              <span className="mr-2 text-xs font-bold tabular-nums text-ink-300">
                {String(i + 1).padStart(2, '0')}
              </span>
              {step.title}
            </h3>
            <p className="journey-body mt-1.5 max-w-xl text-sm leading-relaxed text-ink-400">
              {step.description}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}


/** Smooth cubic path through the measured dot centers (viewBox units). */
function buildPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  if (points.length === 1) return `M ${first.x} ${first.y}`;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const dy = (curr.y - prev.y) / 2;
    d += ` C ${prev.x} ${prev.y + dy}, ${curr.x} ${curr.y - dy}, ${curr.x} ${curr.y}`;
  }
  return d;
}
