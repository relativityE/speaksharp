// @vitest-environment node
/**
 * #1258 — a failed coaching generation names its cause in the RWT receipt. `get-ai-suggestions` returns a closed,
 * content-free `reason` in its 502 body; the specs read it into the coaching row as `failureReason`. Only the closed
 * set passes through — any other value reads 'unrecognized', so no provider or model text can enter a receipt.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COACHING_FAILURE_REASONS, coachingFailureReason } from '../live/helpers/rwtJourney';

describe('#1258 coaching failure reason in the receipt', () => {
    it('every closed reason the Edge function returns passes through unchanged', () => {
        for (const reason of COACHING_FAILURE_REASONS) expect(coachingFailureReason({ error: 'x', reason })).toBe(reason);
    });

    it('the closed set is exactly the Edge function\'s', () => {
        const edge = readFileSync(path.resolve(__dirname, '../../backend/supabase/functions/get-ai-suggestions/index.ts'), 'utf8');
        const union = /export type CoachingFailureReason =([^;]+);/.exec(edge)?.[1] ?? '';
        const edgeReasons = [...union.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
        expect([...COACHING_FAILURE_REASONS].sort()).toEqual(edgeReasons);
    });

    it('anything outside the closed set — including free text — reads "unrecognized"; no reason reads null', () => {
        expect(coachingFailureReason({ reason: 'the provider said: your prompt contained …' })).toBe('unrecognized');
        expect(coachingFailureReason({ reason: 42 })).toBe('unrecognized');
        expect(coachingFailureReason({ error: 'AI coaching could not be generated.' })).toBeNull();
        expect(coachingFailureReason(null)).toBeNull();
        expect(coachingFailureReason('not an object')).toBeNull();
    });

    it('both RWT specs read the reason on a failed response and carry it in the coaching row', () => {
        const openMic = readFileSync(path.resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const focus = readFileSync(path.resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        const journey = readFileSync(path.resolve(__dirname, '../live/helpers/rwtJourney.ts'), 'utf8');
        for (const src of [openMic, focus]) {
            expect(src).toMatch(/if \(response\.status\(\) >= 400\) void response\.json\(\)\.then\(\(b\) => \{ coaching\.reason = coachingFailureReason\(b\); \}/);
        }
        expect(openMic).toMatch(/httpStatus: coaching\.status, failureReason: coaching\.reason/);
        expect(journey).toMatch(/httpStatus: request\.status, failureReason: request\.reason \?\? null/);
    });
});
