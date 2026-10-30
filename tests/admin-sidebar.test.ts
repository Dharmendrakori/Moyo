/// <reference types="vitest/globals" />

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SIDEBAR_COOKIE } from '../src/lib/admin-nav';

/**
 * ADMIN SIDEBAR COLLAPSE/EXPAND REGRESSION TESTS
 *
 * The reported defect: collapsing the desktop sidebar made the expand control
 * disappear, so the rail could only be reopened by reloading. The cause was a
 * conditional `lg:hidden` class on the toggle itself, keyed on the collapsed
 * state.
 *
 * These assertions are deliberately structural. There is no DOM environment in
 * this suite (see vitest.config.mts), so instead of rendering the component the
 * tests pin the invariants that made the bug possible:
 *
 *  1. the toggle is never conditionally hidden, and holds a real click target;
 *  2. it exposes directional icons and the correct aria wiring in both states;
 *  3. the collapsed rail still fits the mark plus the toggle;
 *  4. the mobile drawer stays an independent state with its own control;
 *  5. the remembered preference is read on the server and matched exactly.
 *
 * The behavioural half of this fix was verified in a real browser (see README:
 * "Admin sidebar - browser verification").
 */

const CHROME = readFileSync(
  path.join(process.cwd(), 'src', 'components', 'admin', 'Chrome.tsx'),
  'utf8',
);
const LAYOUT = readFileSync(path.join(process.cwd(), 'src', 'app', 'admin', 'layout.tsx'), 'utf8');

/** The markup of the desktop toggle only, from its opening tag to its close. */
function toggleMarkup(): string {
  const testId = CHROME.indexOf('data-testid="admin-sidebar-toggle"');
  expect(testId, 'desktop toggle must exist').toBeGreaterThan(-1);
  const start = CHROME.lastIndexOf('<button', testId);
  const end = CHROME.indexOf('</button>', testId);
  return CHROME.slice(start, end);
}

describe('desktop sidebar toggle', () => {
  it('is never hidden when the sidebar is collapsed', () => {
    const markup = toggleMarkup();
    // The regression: `sidebarCollapsed ? 'lg:hidden' : ''` on the button.
    expect(markup).not.toContain('lg:hidden');
    expect(markup).not.toContain('hidden');
  });

  it('stays visible at every breakpoint the sidebar itself renders at', () => {
    // The toggle lives inside the lg-only <aside>, so no responsive hiding of
    // its own is needed - and none may be added.
    const aside = CHROME.slice(CHROME.indexOf('<aside'), CHROME.indexOf('</aside>'));
    expect(aside).toContain('lg:flex');
    expect(aside).toContain('id="admin-sidebar"');
    expect(toggleMarkup()).toContain('aria-controls="admin-sidebar"');
  });

  it('points the right way in both states', () => {
    expect(toggleMarkup()).toContain("sidebarCollapsed ? 'chevron-right' : 'chevron-left'");
  });

  it('reports its expanded state and labels both directions', () => {
    const markup = toggleMarkup();
    expect(markup).toContain('aria-expanded={!sidebarCollapsed}');
    expect(markup).toContain("sidebarCollapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'");
    // Title doubles as the tooltip on a desktop pointer.
    expect(markup).toContain('title={sidebarCollapsed ?');
  });

  it('is a real button with a click target of at least 32px', () => {
    const markup = toggleMarkup();
    expect(markup).toContain('type="button"');
    expect(markup).toContain('h-8 w-8');
  });

  it('flips one shared desktop state, not a copy', () => {
    expect(CHROME).toContain('useState(defaultSidebarCollapsed)');
    expect(CHROME).toContain('setSidebarCollapsed');
    expect(CHROME).toContain('sidebarCollapsed ? \'lg:w-20\' : \'lg:w-64\'');
    // The collapsed rail must be able to hold the mark (h-8) and the toggle (h-8).
    expect(CHROME).toContain("sidebarCollapsed ? 'h-8 w-8' : 'h-9 w-9'");
  });
});

describe('mobile drawer stays independent of the desktop rail', () => {
  it('keeps its own state, opener and accessible name', () => {
    expect(CHROME).toContain('useState(false)');
    expect(CHROME).toContain('data-testid="admin-mobile-opener"');
    expect(CHROME).toContain('id="admin-mobile-drawer"');
    expect(CHROME).toContain('aria-label="Open navigation"');
    expect(CHROME).toContain('aria-label="Close navigation"');
    expect(CHROME).toContain('lg:hidden');
  });

  it('keeps the backdrop and Escape-to-close', () => {
    expect(CHROME).toContain('setDrawerOpen(false)');
    expect(CHROME).toContain("event.key === 'Escape'");
    expect(CHROME).toContain('aria-modal="true"');
  });

  it('does not derive the drawer from the desktop collapse state', () => {
    // `drawerOpen` must never be written from `sidebarCollapsed`.
    expect(CHROME).not.toMatch(/setDrawerOpen\([^)]*sidebarCollapsed/);
  });
});

describe('remembered preference', () => {
  it('uses one cookie name shared by the client and the server', () => {
    expect(SIDEBAR_COOKIE).toBe('moyo_admin_nav');
    expect(CHROME).toContain('SIDEBAR_COOKIE');
    expect(LAYOUT).toContain('SIDEBAR_COOKIE');
  });

  it('is read on the server and matched exactly, so a tampered value cannot collapse the UI', () => {
    expect(LAYOUT).toContain('cookies()');
    expect(LAYOUT).toContain("=== 'collapsed'");
    expect(LAYOUT).toContain('defaultSidebarCollapsed={sidebarCollapsed}');
  });

  it('never initialises visible state from the browser during render (hydration safety)', () => {
    // A localStorage read in a useState initialiser, or an effect that sets the
    // state on mount, would either mismatch the SSR markup or flash the wrong
    // width. The preference must arrive as a server-rendered prop instead.
    expect(CHROME).not.toMatch(/localStorage\s*\./);
    expect(CHROME).not.toMatch(/useEffect\([^)]*setSidebarCollapsed/);
  });
});
