// @vitest-environment node
/**
 * #1258 F4 (Backup PM RETURN 6025844013) — an observed `empty` must never settle a coaching journey.
 *
 * RWT runs 37547966019 and 37550720328 read the card as `empty` in the moment before its automatic request was in
 * flight, recorded "coaching did not render" and left the page; the server finished the coaching ~25 s later. The
 * product no longer publishes `empty`, and every journey that waits on the card must also refuse to accept it: the
 * terminal set is exactly ready | error | blocked, and pending | loading keep the wait going.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WAITERS = [
    'tests/e2e/theme-matrix-1480.e2e.spec.ts',
    'tests/e2e/user-facing-regressions.e2e.spec.ts',
    'tests/live/helpers/rwtJourney.ts',
    'tests/live/practice-loop-journey.live.spec.ts',
    'tests/live/rwt-open-mic-first-session.live.spec.ts',
] as const;
const TERMINAL = '/^(ready|error|blocked)$/';

/** Every regex literal in the file whose alternatives name the coaching card's settled states. */
const reviewStateMatchers = (source: string): string[] => source.match(/\/\^\((?:[a-z]+\|)*ready\|error(?:\|[a-z]+)*\)\$\//g) ?? [];

describe('coaching journeys settle only on ready | error | blocked (F4)', () => {
    it.each(WAITERS)('%s waits on the exact terminal set and never on empty', (file) => {
        const matchers = reviewStateMatchers(readFileSync(resolve(__dirname, '../..', file), 'utf8'));
        expect(matchers.length, 'the file still waits on the coaching card').toBeGreaterThan(0);
        for (const m of matchers) expect(m).toBe(TERMINAL);
    });

    it('CASUALTY: the observed pre-request `empty` does not settle the wait; pending and loading keep it going', () => {
        const terminal = new RegExp('^(ready|error|blocked)$');
        expect(['empty', 'pending', 'loading', ''].filter((state) => terminal.test(state))).toEqual([]);
        expect(['ready', 'error', 'blocked'].filter((state) => terminal.test(state))).toEqual(['ready', 'error', 'blocked']);
    });

    it('the source contract that locates the Focus poll uses the same terminal set', () => {
        const contract = readFileSync(resolve(__dirname, 'rwtCoachingReason1258.test.ts'), 'utf8');
        expect(contract).toContain('toMatch(/^(ready|error|blocked)$/)');
        expect(contract).not.toContain('ready|error|empty');
    });
});
