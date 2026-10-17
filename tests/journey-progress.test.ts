/// <reference types="vitest/globals" />

/**
 * JOURNEY PROGRESS TESTS
 *
 * Pins the deterministic contract behind the scroll-driven SVG spine in
 * `src/components/customer/JourneyLine.tsx` (`journeyProgressFor`):
 * progress is anchored to the MEASURED first→last dot span, so the line
 * reaches exactly 1 (Step 4 lit) when the reading line meets the final dot —
 * regardless of section padding or viewport height. Tests assert the pure
 * function only, never animation timing.
 */
import { journeyProgressFor } from '../src/components/customer/JourneyLine';

describe('journeyProgressFor', () => {
  it('starts at 0 when the reading line meets the first dot', () => {
    // vh=800 → reading line at 440; list top 0, first dot at 440.
    expect(journeyProgressFor(-440 + 440, 440, 1440, 800)).toBeCloseTo(0, 10);
  });

  it('reaches exactly 1 when the reading line meets the last dot', () => {
    // Last dot 1000px below the first; reading line exactly on it.
    const first = 200;
    const last = 1200;
    const vh = 800;
    const listTop = vh * 0.55 - last;
    expect(journeyProgressFor(listTop, first, last, vh)).toBe(1);
  });

  it('stays complete once the section is fully traversed', () => {
    const first = 200;
    const last = 1200;
    const vh = 800;
    const listTop = vh * 0.55 - last - 400;
    expect(journeyProgressFor(listTop, first, last, vh)).toBe(1);
  });

  it('activates middle steps proportionally along the dot span', () => {
    const first = 0;
    const last = 900;
    const vh = 900;
    // Reading line at 495; halfway through the span → ~0.5+.
    const mid = journeyProgressFor(495 - 450, first, last, vh);
    expect(mid).toBeGreaterThanOrEqual(0.5);
    expect(mid).toBeLessThan(0.75);
  });

  it('clamps before the first dot and on degenerate spans', () => {
    expect(journeyProgressFor(1000, 200, 1200, 800)).toBe(0);
    expect(journeyProgressFor(0, 500, 500, 800)).toBe(1);
    expect(journeyProgressFor(0, 600, 500, 800)).toBe(1);
  });

  it('is viewport-independent at the endpoints', () => {
    for (const vh of [360, 768, 1024, 1440]) {
      const first = 150;
      const last = 1150;
      const atLast = vh * 0.55 - last;
      expect(journeyProgressFor(atLast, first, last, vh)).toBe(1);
      const atFirst = vh * 0.55 - first;
      expect(journeyProgressFor(atFirst, first, last, vh)).toBe(0);
    }
  });
});
