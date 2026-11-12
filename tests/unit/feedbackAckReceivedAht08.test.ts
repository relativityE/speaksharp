// @vitest-environment node
// AHT-08 (fifteen-case front-run review, 2026-11-10): the No-session feedback test gets its own `fresh acknowledgment` row
// (earlier toasts marked first, dialog detached, an unmarked toast) and an in-spec `received feedback` row (exactly one
// `feedback_submit` attempted plus one storage_ok with the same submit_seq). AHT-07's submit path is unchanged.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import {
    ACK_COPY, ACK_TOAST, PREVIOUS_ACK_ATTR, freshAcknowledgmentVerdict, markEarlierAcknowledgments, observeFreshAcknowledgment,
    receivedFeedbackVerdict, writeFreshAcknowledgmentRow, writeReceivedFeedbackRow, type FeedbackSubmitEvent, type FreshAcknowledgmentObservation,
} from '../live/helpers/feedbackDiagnosticRef';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHA = 'a'.repeat(40);

describe('freshAcknowledgmentVerdict', () => {
    const ok: FreshAcknowledgmentObservation = { marked: true, earlier: 1, dialogDetached: true, freshToastVisible: true };
    it('marked, dialog detached and an unmarked toast → PASS', () => expect(freshAcknowledgmentVerdict(ok).verdict).toBe('PASS'));
    it('the dialog stayed open → FAIL', () => expect(freshAcknowledgmentVerdict({ ...ok, dialogDetached: false }).verdict).toBe('FAIL'));
    it('only an earlier (marked) toast, no fresh one → FAIL', () => {
        const v = freshAcknowledgmentVerdict({ ...ok, freshToastVisible: false });
        expect(v.verdict).toBe('FAIL');
        expect(v.detail).toMatch(/not already on the page/);
    });
    it('earlier toasts could not be marked, or nothing was observed → HOLD, never PASS', () => {
        expect(freshAcknowledgmentVerdict({ ...ok, marked: false }).verdict).toBe('HOLD');
        expect(freshAcknowledgmentVerdict(null).verdict).toBe('HOLD');
    });
    it('writes the `fresh acknowledgment` row', () => {
        const rows: Array<[string, string]> = [];
        writeFreshAcknowledgmentRow({ row: (s, v) => { rows.push([s, v]); } }, ok);
        expect(rows).toEqual([['fresh acknowledgment', 'PASS']]);
    });
});

/** A page whose toast marking and two waits are scripted; it records the selectors it was asked for. */
function fakePage(script: { markRejects?: boolean; earlier?: number; detached?: boolean; fresh?: boolean }) {
    const selectors: string[] = [];
    const wait = (ok: boolean | undefined) => ({ waitFor: async () => { if (!ok) throw new Error('Timeout'); } });
    const page = {
        locator: (sel: string) => {
            selectors.push(sel);
            return {
                evaluateAll: async () => { if (script.markRejects) throw new Error('closed'); return script.earlier ?? 0; },
                filter: ({ hasText }: { hasText: string }) => { selectors.push(`text=${hasText}`); return { first: () => wait(script.fresh) }; },
            };
        },
        getByTestId: (id: string) => { selectors.push(`testid=${id}`); return wait(script.detached); },
    } as unknown as Page;
    return { page, selectors };
}

describe('markEarlierAcknowledgments / observeFreshAcknowledgment', () => {
    it('marks the toasts present before the submit, then requires an UNMARKED acknowledgment and the dialog detached', async () => {
        const { page, selectors } = fakePage({ earlier: 2, detached: true, fresh: true });
        const earlier = await markEarlierAcknowledgments(page);
        expect(earlier).toEqual({ marked: true, earlier: 2 });
        const o = await observeFreshAcknowledgment(page, earlier, 10);
        expect(o).toEqual({ marked: true, earlier: 2, dialogDetached: true, freshToastVisible: true });
        expect(selectors).toContain(ACK_TOAST);
        expect(selectors).toContain(`${ACK_TOAST}:not([${PREVIOUS_ACK_ATTR}])`);
        expect(selectors).toContain(`text=${ACK_COPY}`);
        expect(selectors).toContain('testid=issue-report-dialog');
    });
    it('a page that cannot be marked → marked false (HOLD)', async () => {
        const { page } = fakePage({ markRejects: true });
        const earlier = await markEarlierAcknowledgments(page);
        expect(earlier.marked).toBe(false);
        expect(freshAcknowledgmentVerdict(await observeFreshAcknowledgment(page, earlier, 10)).verdict).toBe('HOLD');
    });
    it('timeouts are observations (false), never throws', async () => {
        const { page } = fakePage({ detached: false, fresh: false });
        const o = await observeFreshAcknowledgment(page, { marked: true, earlier: 0 }, 10);
        expect(o).toMatchObject({ dialogDetached: false, freshToastVisible: false });
        expect(freshAcknowledgmentVerdict(o).verdict).toBe('FAIL');
    });
});

const ev = (outcome: string, over: Partial<FeedbackSubmitEvent> = {}, seq: unknown = 1): FeedbackSubmitEvent => ({
    event: 'feedback_submit', bootId: 'b1', journeyId: 'j1', releaseSha: SHA, trafficType: 'canary',
    fields: { outcome, submit_seq: seq as number }, ...over,
});
const opts = { blindSinceSubmit: 0, expectedReleaseSha: SHA };

describe('receivedFeedbackVerdict', () => {
    it('exactly one attempted and one storage_ok with the same submit_seq and identity → PASS', () => {
        const v = receivedFeedbackVerdict([ev('attempted'), ev('storage_ok')], opts);
        expect(v.verdict).toBe('PASS');
        expect(v.evidence).toEqual({ events: 2, attempted: 1, storageOk: 1, storageFailed: 0, blindSinceSubmit: 0 });
    });
    it('other events in the window are ignored', () => {
        expect(receivedFeedbackVerdict([{ event: 'journey_step' }, ev('attempted'), ev('storage_ok')], opts).verdict).toBe('PASS');
    });
    it.each([
        ['storage_failed', [ev('attempted'), ev('storage_failed')]],
        ['a second pair', [ev('attempted'), ev('storage_ok'), ev('attempted', {}, 2), ev('storage_ok', {}, 2)]],
        ['two attempts, no outcome', [ev('attempted'), ev('attempted', {}, 2)]],
        ['two storage_ok', [ev('storage_ok'), ev('storage_ok')]],
        ['a different submit_seq', [ev('attempted'), ev('storage_ok', {}, 2)]],
        ['a non-integer submit_seq', [ev('attempted', {}, '1'), ev('storage_ok', {}, '1')]],
        ['submit_seq 0', [ev('attempted', {}, 0), ev('storage_ok', {}, 0)]],
        ['another boot', [ev('attempted'), ev('storage_ok', { bootId: 'b2' })]],
        ['another journey', [ev('attempted'), ev('storage_ok', { journeyId: 'j2' })]],
        ['another release', [ev('attempted', { releaseSha: 'b'.repeat(40) }), ev('storage_ok', { releaseSha: 'b'.repeat(40) })]],
        ['user traffic', [ev('attempted', { trafficType: 'user' }), ev('storage_ok', { trafficType: 'user' })]],
    ])('%s → FAIL', (_l, events) => expect(receivedFeedbackVerdict(events, opts).verdict).toBe('FAIL'));
    it('an observed storage_failed FAILS even with a blind beacon', () => {
        expect(receivedFeedbackVerdict([ev('attempted'), ev('storage_failed')], { ...opts, blindSinceSubmit: 1 }).verdict).toBe('FAIL');
    });
    it.each([
        ['nothing observed', [], opts],
        ['only the attempt', [ev('attempted')], opts],
        ['a blind beacon since the submit', [ev('attempted'), ev('storage_ok')], { ...opts, blindSinceSubmit: 1 }],
        ['a missing identity field', [ev('attempted', { journeyId: undefined }), ev('storage_ok', { journeyId: undefined })], opts],
        ['an unknown expected release', [ev('attempted'), ev('storage_ok')], { ...opts, expectedReleaseSha: '' }],
    ])('%s → HOLD, never PASS', (_l, events, o) => expect(receivedFeedbackVerdict(events, o).verdict).toBe('HOLD'));
    it('writes the `received feedback` row with counts only', () => {
        const rows: Array<[string, string, Record<string, unknown> | undefined]> = [];
        writeReceivedFeedbackRow({ row: (s, v, _d, e) => { rows.push([s, v, e]); } }, [ev('attempted'), ev('storage_ok')], opts);
        expect(rows[0][0]).toBe('received feedback');
        expect(rows[0][1]).toBe('PASS');
        expect(JSON.stringify(rows[0][2])).not.toMatch(/b1|j1|aaaa/);
    });
});

describe('the spec wires the AHT-08 rows, and leaves AHT-07\'s submit unchanged', () => {
    const spec = readFileSync(path.resolve(here, '../live/rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
    const at = (needle: string, from = 0) => {
        const i = spec.indexOf(needle, from);
        if (i < 0) throw new Error(`the spec lacks: ${needle}`);
        return i;
    };
    it('submit: earlier toasts are marked and the window recorded BEFORE the click; the fresh observation precedes the acknowledgement throw', () => {
        const body = at('async function submitOpenDialog(');
        const mark = at('const earlierAcks = observers ? await markEarlierAcknowledgments(page) : null;', body);
        const window = at('observers?.onSubmitted({ feedbackBefore, submitAt: Date.now() });', body);
        const click = at("await page.getByTestId('issue-report-submit').click();", body);
        const fresh = at('if (observers && earlierAcks) observers.onFreshAcknowledgment(await observeFreshAcknowledgment(page, earlierAcks));', body);
        const thrown = at("if (!acknowledged) throw new Error('the feedback acknowledgement was not shown');", body);
        expect(at('const feedbackBefore = tap.sent(\'feedback_submit\').length;', body)).toBeLessThan(mark);
        expect(mark).toBeLessThan(window);
        expect(window).toBeLessThan(click);
        expect(click).toBeLessThan(fresh);
        expect(fresh).toBeLessThan(thrown);
    });
    it('AHT-07 passes no observers (its submit path and rows are unchanged); AHT-08 passes both', () => {
        const older = spec.slice(at("test('feedback selected for an older take links only to that take'"), at("test('No session feedback stores no take or coaching link'"));
        expect(older).toMatch(/await submitFeedback\(page, tap, owner\.uid, 'selected_older_session', olderId, newerId\);/);
        expect(older).not.toMatch(/fresh acknowledgment|received feedback|onFreshAcknowledgment|onSubmitted/);
        const none = spec.slice(at("test('No session feedback stores no take or coaching link'"));
        expect(none).toMatch(/submitFeedback\(page, tap, owner\.uid, 'no_session', null, undefined, \{\n\s+onSubmitted: \(submitted\) => \{ submitWindow = submitted; \},\n\s+onFreshAcknowledgment: \(observation\) => writeFreshAcknowledgmentRow\(receipt, observation\),/);
    });
    it('AHT-08 finalization: the received row is written after the telemetry settle, from the events since the submit, before cleanup', () => {
        const none = spec.slice(at("test('No session feedback stores no take or coaching link'"));
        const settle = none.indexOf("await steps.step('telemetry settle'");
        const received = none.indexOf("await steps.step('received feedback'");
        const cleanup = none.indexOf('finalizeOwnedCleanup(');
        expect(settle).toBeGreaterThan(-1);
        expect(settle).toBeLessThan(received);
        expect(received).toBeLessThan(cleanup);
        expect(none).toMatch(/tap\.sent\('feedback_submit'\)\.slice\(submitted\.feedbackBefore\)/);
        expect(none).toMatch(/blindSinceSubmit: tap\.blindAt\.filter\(\(t\) => t >= submitted\.submitAt\)\.length, expectedReleaseSha: expectedReleaseSha\(\)/);
    });
});
