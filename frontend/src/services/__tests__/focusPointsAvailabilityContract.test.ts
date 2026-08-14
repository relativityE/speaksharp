import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isPracticeSurface, resolvePageContext, issueAreasForContext, ALL_ISSUE_AREAS,
} from '@/services/pageContext';
import * as practiceTelemetry from '@/services/practiceTelemetry';

// #1294 finding #6 — Focus Points is an ACTIVATED product (optional guidance). These NEGATIVE proofs fail
// closed if any "unavailable/planned" Focus Points contract returns to the Report Issue page-context, the
// issue areas, or the practice telemetry surface. (The truthful setup token is `objective_setup`.)

// Source-scan reads from the repo root (vitest cwd) — the frontend service sources under version control.
const srcPath = (name: string) => resolve(process.cwd(), 'frontend/src/services', name);
const pageContextSrc = readFileSync(srcPath('pageContext.ts'), 'utf8');
const telemetrySrc = readFileSync(srcPath('practiceTelemetry.ts'), 'utf8');

describe('#1294 — no "objective unavailable" contract survives (page context)', () => {
  it('rejects the retired `objective_unavailable` surface token (fails closed to practice_home)', () => {
    expect(isPracticeSurface('objective_unavailable')).toBe(false);
    expect(resolvePageContext('/practice', 'objective_unavailable').practiceSurface).toBe('practice_home');
  });

  it('accepts the truthful `objective_setup` surface with no "unavailable" in label or journey step', () => {
    const ctx = resolvePageContext('/practice', 'objective_setup');
    expect(ctx.practiceSurface).toBe('objective_setup');
    expect(ctx.journeyStep).toBe('objective_setup');
    expect(ctx.pageLabel).toBe('Focus Points');
    expect(`${ctx.journeyStep} ${ctx.pageLabel}`.toLowerCase()).not.toContain('unavailable');
  });

  it('the Focus Points setup issue areas do NOT offer an "Availability" area', () => {
    const areas = issueAreasForContext(resolvePageContext('/practice', 'objective_setup')).map((a) => a.value);
    expect(areas).not.toContain('availability');
    expect(ALL_ISSUE_AREAS).not.toContain('availability');
  });

  it('the page-context source describes Focus Points as available, never planned/not-a-working-product', () => {
    expect(pageContextSrc).not.toMatch(/objective_unavailable/);
    expect(pageContextSrc.toLowerCase()).not.toMatch(/planned, not a working product|is planned, not/);
  });
});

describe('#1294 — no "objective unavailable" telemetry survives', () => {
  it('exposes NO trackObjectiveUnavailable export', () => {
    expect((practiceTelemetry as Record<string, unknown>).trackObjectiveUnavailable).toBeUndefined();
  });

  it('the telemetry source emits no `objective_unavailable_selected` event', () => {
    // The only allowed mention is the removal NOTE; there must be no `emit('objective_unavailable_selected'...)`.
    expect(telemetrySrc).not.toMatch(/emit\(\s*['"]objective_unavailable_selected['"]/);
  });
});
