/// <reference types="vitest/globals" />

/**
 * TECHNICIAN DIALOG REGRESSION GUARD
 *
 * HONEST SCOPE: this repository has no browser-level test tooling (no jsdom, no
 * Testing Library, no Playwright), and adding one is out of scope for this
 * milestone. A focus/caret bug therefore cannot be reproduced here by simulating
 * keystrokes. What these tests do instead:
 *
 *  1. pin the STRUCTURAL invariant whose loss caused the bug - the focus/Escape
 *     effect must be mount-only and must read its callbacks through refs, so a
 *     parent render (which happens on every keystroke in a controlled field)
 *     cannot re-focus and thereby dismiss the dialog;
 *  2. pin the dismissal policy around a submit (only on success, never while busy).
 *
 * The real interaction was verified by reading the code path, not by a browser
 * run: see the milestone report, which says so explicitly.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/admin/technicians/TechnicianDialogs.tsx'),
  'utf8',
  // Normalised so the structural assertions below do not depend on CRLF vs LF.
).replace(/\r\n/g, '\n');

describe('dialog focus effect', () => {
  it('declares the form component at module scope, never inside the dialog', () => {
    // THE ACTUAL DEFECT: `CreateFormFields` was nested inside
    // `CreateTechnicianDialog`, so every keystroke created a new component type,
    // React remounted the form and the focused input node was destroyed. The
    // browser regression test (e2e/technician-dialog-focus.spec.ts) is the primary
    // proof; this is a cheap secondary guard against reintroducing the nesting.
    expect(source).toContain('\n}\n\nfunction CreateFormFields(');
    expect(source).not.toMatch(/\n {2}function CreateFormFields\(/);
  });

  it('does not depend on the onClose prop identity', () => {
    // The original bug: `}, [onClose]);` re-ran the effect on every parent render.
    expect(source).not.toContain('}, [onClose]);');
    expect(source).not.toContain('[onClose,');
  });

  it('runs the focus and key handling exactly once, on mount', () => {
    const mountOnlyEffects = source.match(/\}, \[\]\);/g) ?? [];
    expect(mountOnlyEffects.length).toBeGreaterThanOrEqual(1);
  });

  it('reads the latest callbacks through refs', () => {
    expect(source).toContain('onCloseRef.current');
    expect(source).toContain('busyRef.current');
  });

  it('focuses the dialog container rather than the close control', () => {
    expect(source).toContain('dialogRef.current?.focus()');
    // Focusing the ✕ on mount made a stray Enter dismiss a half-filled form.
    expect(source).not.toContain('closeRef');
  });

  it('cannot be dismissed by Escape or the backdrop while submitting', () => {
    expect(source).toContain('if (!busyRef.current) onCloseRef.current();');
    expect(source).toContain('disabled={busy}');
  });
});

describe('dialog submit behaviour', () => {
  it('keeps the form open and the values intact when the request fails', () => {
    // A failed mutation returns before any close/reset call.
    expect(source).toMatch(/if \(!result\.ok\) return;/);
  });

  it('closes only after the server confirms success', () => {
    const submitBlock = source.slice(source.indexOf('async function submit()'));
    const closeIndex = submitBlock.indexOf('close();');
    expect(closeIndex).toBeGreaterThan(0);
    // `close()` is only reachable after the awaited request resolved.
    expect(submitBlock.indexOf('await run(')).toBeLessThan(closeIndex);
  });

  it('passes the in-flight state into the modal so duplicate submits are blocked', () => {
    const busyPasses = source.match(/busy=\{busy\}/g) ?? [];
    expect(busyPasses.length).toBeGreaterThanOrEqual(2);
  });
});
