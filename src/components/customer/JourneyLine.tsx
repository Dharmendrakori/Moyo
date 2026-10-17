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

/**
 * DETERMINISTIC JOURNEY PROGRESS (pure, unit-testable)
 *
 * The line must reach the LAST dot exactly when the last milestone is fully
 * traversed — never stall at ~0.97 on tall sections. Instead of normalising
 * over the whole `<ol>` height plus viewport padding (which leaves a long
 * tail of "dead" scroll after the final dot where progress asymptotically
 * approaches but rarely hits 1), progress is anchored to measured dot
 * positions:
 *
 * - `firstDotTop` / `lastDotTop`: distances (px) from the list top to the
 *   centers of the first and last dots, re-measured on layout/resize.
 * - the viewport "reading line" sits at `viewportHeight * anchorRatio`
 *   (0.55 ≈ just below middle, where the eye rests while scrolling).
 * - progress = (readingLine − firstDotAbsoluteTop) / (lastDot − firstDot):
 *   0 when the reading line meets the first dot, 1 when it meets the last.
 *
 * All inputs are plain numbers, so tests can pin the contract without
 * touching the DOM or animation timing.
 */
export function journeyProgressFor(
  listTopViewportPx: number,
  firstDotOffsetPx: number,
  lastDotOffsetPx: number,
  viewportHeightPx: number,
  anchorRatio = 0.55,
): number {
  const vh = Math.max(1, viewportHeightPx);
  const readingLine = vh * anchorRatio;
  const span = lastDotOffsetPx - firstDotOffsetPx;
  if (!(span > 0)) return 1;
  const firstAbsolute = listTopViewportPx + firstDotOffsetPx;
  return clamp01((readingLine - firstAbsolute) / span);
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
    // Dot centers (px) measured from the list top. Progress anchors to the
    // FIRST→LAST dot span so Step 4 always completes — never to the whole
    // section height, which left a dead-scroll tail where the line stalled.
    let firstTop = 0;
    let lastTop = 0;

    /** Re-measure dot centers and rebuild the curve in viewBox units. */
    const layout = () => {
      const listRect = list.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      if (listRect.height === 0 || svgRect.width === 0) return;
      const scaleX = VIEW_W / svgRect.width;
      const scaleY = 1000 / listRect.height;
      const tops: number[] = [];
      const points = dots.map((dot) => {
        const r = dot.getBoundingClientRect();
        tops.push(r.top + r.height / 2 - listRect.top);
        return {
          x: (r.left + r.width / 2 - svgRect.left) * scaleX,
          y: (r.top + r.height / 2 - listRect.top) * scaleY,
        };
      });
      if (tops.length > 0) {
        firstTop = tops[0] as number;
        lastTop = tops[tops.length - 1] as number;
      }
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
      // Anchored to the measured FIRST→LAST dot span (see journeyProgressFor):
      // progress hits exactly 1 when the reading line reaches the last dot,
      // so Step 4 always completes regardless of section padding or viewport.
      const progress = journeyProgressFor(rect.top, firstTop, lastTop, vh);
      line.style.strokeDashoffset = String(1 - progress);
      const last = Math.max(1, dots.length - 1);
      dots.forEach((dot, i) => {
        dot.closest('.journey-step')?.classList.toggle('is-active', progress >= i / last);
      });
    };

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    const onResize = () => {
      // Geometry changed: rebuild the curve FIRST, then repaint on next frame.
      layout();
      onScroll();
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
    window.addEventListener('resize', onResize, { passive: true });
    const ro = new ResizeObserver(() => {
      layout();
      onScroll();
    });
    ro.observe(list);
    // Late layout (webfonts, images): re-measure once the page settles so the
    // curve and the dot-span anchors match the final positions.
    const settled = window.setTimeout(() => {
      layout();
      onScroll();
    }, 600);
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        layout();
        onScroll();
      });
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.clearTimeout(settled);
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
        className="pointer-events-none absolute inset-y-0 left-2 w-14 sm:left-1/2 sm:w-32 sm:-translate-x-1/2"
        viewBox={`0 0 ${VIEW_W} 1000`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="journeyGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="55%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#d9a441" />
          </linearGradient>
        </defs>
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
          className="journey-step relative py-8 pl-16 sm:grid sm:grid-cols-2 sm:items-center sm:gap-12 sm:py-14 sm:pl-0"
        >
          {/* Single measured dot: left rail on mobile, spine centre on desktop. */}
          <span
            ref={(el) => {
              if (el) dotRefs.current[i] = el;
            }}
            className="journey-dot absolute left-3 top-9 grid h-11 w-11 place-items-center rounded-full sm:left-1/2 sm:top-1/2 sm:h-14 sm:w-14 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          >
            <Icon name={step.icon} size={20} className="sm:hidden" />
            <span className="hidden sm:contents">
              <Icon name={step.icon} size={22} />
            </span>
          </span>
          <div
            className={`hidden sm:block ${i % 2 === 0 ? 'sm:order-1' : 'sm:order-2'}`}
            aria-hidden
          >
            <p className="font-display text-7xl font-semibold text-ink-200/70 tabular-nums">
              {String(i + 1).padStart(2, '0')}
            </p>
          </div>
          <div className={`relative ${i % 2 === 0 ? 'sm:order-2' : 'sm:order-1'}`}>
            <div className="journey-panel p-6 sm:p-7">
              <p className="eyebrow text-brand-600">
                <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span className="h-px w-8 gold-rule" aria-hidden />
                Step {i + 1} of {steps.length}
              </p>
              <h3 className="journey-title mt-3 font-display text-xl font-semibold text-ink-500 sm:text-2xl">
                {step.title}
              </h3>
              <p className="journey-body mt-2 max-w-xl text-sm leading-relaxed text-ink-400 sm:text-[15px]">
                {step.description}
              </p>
            </div>
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
