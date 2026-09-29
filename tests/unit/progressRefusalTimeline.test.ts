// @vitest-environment node
/**
 * PO 2026-09-29 (PM 5889581027) — the refused-Start reason must be visible within 500 ms of the click and then stay
 * visible while Start is refused. The old check sampled once at ≈+221 ms, before the UI committed (CI runs 36497826662
 * and 36509005423, both passing on retry), so it could not tell a test race from a silent refusal. These pin the pure
 * verdict the e2e timeline feeds: a late, missing or flickering reason fails; the retry's observed shape passes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    FIRST_VISIBLE_DEADLINE_MS, judgeRefusalTimeline, refusalTimelineSummary, type RefusalEvent,
} from '../e2e/progressRefusalTimeline';

const samples = (from: number, n = 12, visible = 1): RefusalEvent[] =>
    Array.from({ length: n }, (_, i) => ({ t: from + i * 270, label: 'sample' as const, visible }));
const refused = (visibleAt: number, extra: RefusalEvent[] = []): RefusalEvent[] => [
    { t: 1000, label: 'baseline', visible: 0 },
    { t: 1010, label: 'start_click' },
    { t: 1100, label: 'refusal_decision' },
    { t: 1150, label: 'store_refusal' },
    { t: visibleAt, label: 'reason_visible' },
    ...samples(visibleAt + 20),
    ...extra,
    { t: visibleAt + 20 + 12 * 270, label: 'sampling_end', visible: 1 },
].sort((a, b) => a.t - b.t);

describe('refused-Start timeline verdict', () => {
    it('the deadline is the PO\'s 500 ms', () => {
        expect(FIRST_VISIBLE_DEADLINE_MS).toBe(500);
    });

    it('a reason visible at +230 ms that stays visible passes (the shape the passing retries showed)', () => {
        expect(judgeRefusalTimeline(refused(1240))).toEqual([]);
        expect(refusalTimelineSummary(refused(1240))).toMatchObject({ refusalDecisionMs: 90, storeRefusalMs: 140, firstVisibleMs: 230, hiddenAfterVisible: 0, samples: 12 });
    });

    it('exactly at the deadline passes; one millisecond later fails', () => {
        expect(judgeRefusalTimeline(refused(1010 + 500))).toEqual([]);
        expect(judgeRefusalTimeline(refused(1010 + 501))).toEqual([expect.stringMatching(/first became visible 501 ms after the Start click \(deadline 500 ms\)/)]);
    });

    it('CASUALTY: a reason that never appears fails — the wait is a deadline, not a sleep before a passing snapshot', () => {
        const never = refused(1240).filter((e) => e.label !== 'reason_visible').map((e) => (e.label === 'sample' ? { ...e, visible: 0 } : e));
        expect(judgeRefusalTimeline(never)).toContain('the refusal reason never became visible after the Start click');
    });

    it('CASUALTY: a reason that appears on time and then disappears while Start is refused fails (a silent interval)', () => {
        const flicker = refused(1240, [{ t: 2000, label: 'reason_hidden' }, { t: 2050, label: 'reason_visible' }]);
        expect(judgeRefusalTimeline(flicker)).toEqual(['the refusal reason was hidden 1 time(s) while Start was still refused']);
    });

    it('CASUALTY: a sample that finds no visible reason after it first appeared fails, even with no recorded transition', () => {
        const silent = refused(1240).map((e, i, all) => (e.label === 'sample' && all.indexOf(e) === i && e.t > 3000 && e.t < 3300 ? { ...e, visible: 0 } : e));
        expect(judgeRefusalTimeline(silent)).toEqual([expect.stringMatching(/1 sample\(s\) found no visible reason/)]);
    });

    it('a reason shown before the click does not satisfy the deadline, and missing marks fail closed', () => {
        const early: RefusalEvent[] = [{ t: 900, label: 'reason_visible' }, { t: 1010, label: 'start_click' }, ...samples(1100), { t: 5000, label: 'sampling_end' }];
        expect(judgeRefusalTimeline(early)).toContain('the refusal reason never became visible after the Start click');
        expect(judgeRefusalTimeline(refused(1240).filter((e) => e.label !== 'start_click'))).toEqual(['the Start click was not recorded, so the deadline cannot be judged']);
        expect(judgeRefusalTimeline(refused(1240).filter((e) => e.label !== 'sampling_end'))).toContain('the refusal sampling window was not closed, so continuity cannot be judged');
    });
});

describe('instrumentation fails closed (PM 5890479395)', () => {
    const without = (label: RefusalEvent['label']) => refused(1240).filter((e) => e.label !== label);
    const end = (events: RefusalEvent[]) => events.find((e) => e.label === 'sampling_end')!.t;

    it.each(['refusal_decision', 'store_refusal'] as const)('CASUALTY: a missing %s fails — decision, publish and render cannot be told apart', (label) => {
        expect(judgeRefusalTimeline(without(label))).toEqual([`instrumentation: expected exactly one ${label} inside the refusal window, observed 0`]);
    });

    it.each(['refusal_decision', 'store_refusal'] as const)('CASUALTY: a duplicated %s inside the window fails', (label) => {
        const dup = [...refused(1240), { t: 1300, label }].sort((a, b) => a.t - b.t);
        expect(judgeRefusalTimeline(dup)).toEqual([`instrumentation: expected exactly one ${label} inside the refusal window, observed 2`]);
    });

    it.each(['refusal_decision', 'store_refusal'] as const)('CASUALTY: a %s recorded before the click fails', (label) => {
        const early = [...without(label), { t: 1005, label }].sort((a, b) => a.t - b.t);
        expect(judgeRefusalTimeline(early)).toEqual([
            `instrumentation: ${label} was recorded before the Start click`,
            `instrumentation: expected exactly one ${label} inside the refusal window, observed 0`,
        ]);
    });

    it.each(['refusal_decision', 'store_refusal'] as const)('CASUALTY: a %s arriving only after the window closed fails', (label) => {
        const base = without(label);
        const late = [...base, { t: end(base) + 50, label }];
        expect(judgeRefusalTimeline(late)).toEqual([`instrumentation: expected exactly one ${label} inside the refusal window, observed 0`]);
    });

    it('CASUALTY: a reason hidden after the samples but before the held call is released fails', () => {
        const base = refused(1240);
        const closeAt = end(base) + 5000; // the window now also spans the projection and the wait for the held call
        const extended = [...base.filter((e) => e.label !== 'sampling_end'), { t: closeAt - 2000, label: 'reason_hidden' as const }, { t: closeAt, label: 'sampling_end' as const }];
        expect(judgeRefusalTimeline(extended)).toEqual(['the refusal reason was hidden 1 time(s) while Start was still refused']);
    });

    it('the legitimate clear after settlement (after the window closes) is not a flicker', () => {
        const base = refused(1240);
        expect(judgeRefusalTimeline([...base, { t: end(base) + 800, label: 'reason_hidden' }])).toEqual([]);
    });
});

describe('the spec uses the timeline verdict in place of the immediate sample', () => {
    it('closes the continuity window only after the held evaluation is observed and before it is released', () => {
        const src = readFileSync(resolve(__dirname, '../e2e/start-during-progress-settle.e2e.spec.ts'), 'utf8');
        const block = src.slice(src.indexOf("durable debt the page never projected"));
        const held = block.indexOf("heldNow(page, 'record_progress_evaluation')");
        const close = block.indexOf("timelineMark(page, 'sampling_end')");
        const judged = block.indexOf('expect(judgeRefusalTimeline(events)');
        const release = block.indexOf("hold(page, 'record_progress_evaluation', false)");
        const projected = block.indexOf('exactly one visible reason once the gate is projected');
        expect([projected, held, close, judged, release].every((i) => i > 0)).toBe(true);
        expect(projected < held && held < close && close < judged && judged < release).toBe(true);
    });

    const spec = readFileSync(resolve(__dirname, '../e2e/start-during-progress-settle.e2e.spec.ts'), 'utf8');

    it('judges the recorded timeline and attaches it as evidence', () => {
        expect(spec).toMatch(/expect\(judgeRefusalTimeline\(events\)/);
        expect(spec).toMatch(/attach\('progress-refusal-timeline'/);
    });

    it('no longer asserts visibility on an unsynchronized sample right after the click', () => {
        expect(spec).not.toMatch(/'a reason is always visible while the Start is refused'/);
    });

    it('keeps the blocked-state assertions: no recording, no session, no lease', () => {
        expect(spec).toMatch(/'no recording while blocked'/);
        expect(spec).toMatch(/'no session for the refused Start'/);
        expect(spec).toMatch(/'no lease held while blocked'/);
    });
});
