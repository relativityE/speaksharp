// @vitest-environment node
/**
 * #1258 — a failed coaching generation names its cause in the RWT receipt. `get-ai-suggestions` returns a closed,
 * content-free `reason` in its 502 body; the specs read it into the coaching row as `failureReason`. Only the closed
 * set passes through — any other value reads 'unrecognized', so no provider or model text can enter a receipt.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COACHING_FAILURE_REASONS, COACHING_REASON_UNKNOWN, bandSide, coachingFailureReason, readCoachingFailureReason, settleCoachingReason } from '../live/helpers/rwtJourney';

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
            // Codex r4188372882: the read is a retained promise (never fire-and-forget), awaited before the row is written.
            expect(src).toMatch(/if \(response\.status\(\) >= 400\) coaching\.reasonRead = readCoachingFailureReason\(response\)\.then\(\(r\) => \{ coaching\.reason = r; \}\);/);
            expect(src).not.toMatch(/void response\.json\(\)/);
            // Codex r4188372897: no out-of-contract value is ever written.
            expect(src).not.toContain("'unreadable'");
        }
        expect(openMic).toMatch(/httpStatus: coaching\.status, failureReason: coaching\.reason/);
        expect(journey).toMatch(/httpStatus: request\.status, failureReason: request\.reason \?\? null/);
    });

    it('a failed response is read as an awaitable closed reason; a non-JSON body reads "unrecognized" (Codex r4188372897)', async () => {
        await expect(readCoachingFailureReason({ json: async () => ({ error: 'x', reason: 'provider_http_5xx' }) })).resolves.toBe('provider_http_5xx');
        await expect(readCoachingFailureReason({ json: async () => ({ error: 'x' }) })).resolves.toBeNull();
        await expect(readCoachingFailureReason({ json: async () => { throw new SyntaxError('Unexpected token <'); } })).resolves.toBe('unrecognized');
        const out = await readCoachingFailureReason({ json: async () => { throw new Error('<html>Bad gateway</html>'); } });
        expect([...COACHING_FAILURE_REASONS, 'unrecognized', null]).toContain(out);
    });

    it('the row waits for a pending read (Codex r4188372882), but a read that never settles cannot hold the receipt', async () => {
        const coaching: { reason: string | null } = { reason: null };
        const late = new Promise<void>((resolve) => setTimeout(() => { coaching.reason = 'provider_transport'; resolve(); }, 20));
        await settleCoachingReason(late);
        expect(coaching.reason).toBe('provider_transport');
        const started = Date.now();
        // PM 6003371116: a read still pending at the bound reports NOT settled, so the row records UNKNOWN, never null.
        await expect(settleCoachingReason(new Promise<void>(() => undefined), 30)).resolves.toBe(false);
        expect(Date.now() - started).toBeLessThan(1_000);
        await expect(settleCoachingReason(Promise.resolve())).resolves.toBe(true);
        await expect(settleCoachingReason(null)).resolves.toBe(true);
        expect(COACHING_REASON_UNKNOWN).toBe('unknown');
        expect([...COACHING_FAILURE_REASONS, 'unrecognized']).not.toContain(COACHING_REASON_UNKNOWN);
    });

    it('each row settles its reason AFTER the wait in which the failure response arrives (Codex r4189408865)', () => {
        const openMic = readFileSync(path.resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const focus = readFileSync(path.resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        const journey = readFileSync(path.resolve(__dirname, '../live/helpers/rwtJourney.ts'), 'utf8');
        // Open Mic: the settle sits after the terminal-state wait and before the coaching row.
        const omSettle = openMic.indexOf('if (!(await settleCoachingReason(coaching.reasonRead))) coaching.reason = COACHING_REASON_UNKNOWN;');
        expect(omSettle).toBeGreaterThan(-1);
        expect(omSettle).toBeLessThan(openMic.indexOf("receipt.row('coaching rendered'"));
        // Focus: the caller no longer settles early; focusCoachingRows settles after its 180 s terminal poll.
        expect(focus).not.toContain('settleCoachingReason(');
        const fn = journey.slice(journey.indexOf('export async function focusCoachingRows('));
        const poll = fn.indexOf("toMatch(/^(ready|error|empty|blocked)$/)");
        const settle = fn.indexOf('if (!(await settleCoachingReason(request.reasonRead))) request.reason = COACHING_REASON_UNKNOWN;');
        expect(poll).toBeGreaterThan(-1);
        expect(settle).toBeGreaterThan(poll);
        expect(settle).toBeLessThan(fn.indexOf("receipt.row('Focus coaching rendered'"));
    });

    it('the out-of-band text names the side, never "over" for a short phrase (Codex r4189408872)', () => {
        expect(bandSide(3, 9, 8, 10)).toBe('below');
        expect(bandSide(9, 12, 8, 10)).toBe('above');
        expect(bandSide(3, 12, 8, 10)).toBe('below and above');
        for (const file of ['../live/rwt-open-mic-first-session.live.spec.ts', '../live/helpers/rwtJourney.ts']) {
            expect(readFileSync(path.resolve(__dirname, file), 'utf8')).not.toMatch(/a phrase is over the/);
        }
    });
});
