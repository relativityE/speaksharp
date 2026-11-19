/**
 * #1897 Codex P2 (eeab028): on a #1835 saving-off run, the Focus take saved right after the product switch is a metrics-only
 * row (completed, positive duration, no transcript). The journey read its product only from an 'available' row, so the
 * product was null and the switch verdict FAILed ("not saved as Focus Points") before its saving-off branch was reached.
 * `switchSavedFocusProduct` now reads the product from the row its consent asks for, keeping the session and owner checks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { switchIsolationVerdict, switchSavedFocusProduct, switchSourceState, type SwitchIsolationObservation, type SwitchSourceSnapshot } from '../live/helpers/rwtOracles';

const metricsRow = { transcript: null, transcript_state: 'not_captured', status: 'completed', duration: 6 };
const focusSaved = (over: Partial<SwitchSourceSnapshot> = {}): SwitchSourceSnapshot => ({
    product: 'focus_points', digest: null, state: switchSourceState(metricsRow), sessionId: 'fp', userId: 'owner', ...over,
});
const openMic = (over: Partial<SwitchSourceSnapshot> = {}): SwitchSourceSnapshot => ({
    product: 'open_mic', digest: null, state: 'metrics_only', sessionId: 'om', userId: 'owner', ...over,
});
const saveOff = (savedProduct: string | null): SwitchIsolationObservation => ({
    railPendingBefore: true, openMicId: 'om', focusId: 'fp', savedProduct, railRowCount: 4,
    finalStatuses: ['covered', 'missing', 'missing', 'missing'], staleCoachingBeforeStart: false, markerSupport: [true, true, true],
    openMicBefore: openMic(), openMicAfter: openMic(), ownerId: 'owner', transcriptSaving: 'off',
});
const product = (saved: SwitchSourceSnapshot, transcriptSaving: 'on' | 'off', over: { focusId?: string | null; ownerId?: string | null } = {}) =>
    switchSavedFocusProduct({ saved, focusId: 'fp', ownerId: 'owner', transcriptSaving, ...over });

describe('#1897 Codex P2 — the saving-off Focus take is read as Focus Points', () => {
    it('fails before: the old "available only" read gave null, and the switch verdict FAILed on a clean saving-off run', () => {
        const saved = focusSaved();
        const oldRead = saved.state === 'available' && saved.sessionId === 'fp' && saved.userId === 'owner' ? saved.product : null;
        expect(oldRead).toBeNull();
        expect(switchIsolationVerdict(saveOff(oldRead))).toMatchObject({ verdict: 'FAIL', detail: 'the take after the switch was not saved as Focus Points' });
    });

    it('passes after: a metrics-only Focus row of this take and owner gives focus_points, and the saving-off branch PASSes', () => {
        expect(product(focusSaved(), 'off')).toBe('focus_points');
        expect(switchIsolationVerdict(saveOff(product(focusSaved(), 'off'))).verdict).toBe('PASS');
    });

    it('saving on still needs a saved transcript', () => {
        expect(product(focusSaved({ state: 'available', digest: 'd' }), 'on')).toBe('focus_points');
        expect(product(focusSaved(), 'on')).toBeNull();
    });
});

describe('#1897 Codex P2 — controls: anything but this take, this owner and the consented state gives null', () => {
    it.each([
        ['saving off, but a transcript was saved', focusSaved({ state: 'available', digest: 'd' }), 'off', {}],
        ['saving on, but no transcript was saved', focusSaved(), 'on', {}],
        ['another session', focusSaved({ sessionId: 'other' }), 'off', {}],
        ['session unknown on the row', focusSaved({ sessionId: null }), 'off', {}],
        ['another owner', focusSaved({ userId: 'someone-else' }), 'off', {}],
        ['owner unknown on the row', focusSaved({ userId: null }), 'off', {}],
        ['no Focus take id', focusSaved(), 'off', { focusId: null }],
        ['no run owner', focusSaved(), 'off', { ownerId: null }],
        ['no Focus take id, and none on the row either', focusSaved({ sessionId: null }), 'off', { focusId: null }],
        ['no run owner, and none on the row either', focusSaved({ userId: null }), 'off', { ownerId: null }],
        ['malformed row, saving off', focusSaved({ state: 'malformed' }), 'off', {}],
        ['malformed row, saving on', focusSaved({ state: 'malformed' }), 'on', {}],
        ['expired row, saving off', focusSaved({ state: 'expired' }), 'off', {}],
        ['expired row, saving on', focusSaved({ state: 'expired' }), 'on', {}],
        ['missing row', focusSaved({ state: 'missing', sessionId: undefined, userId: undefined }), 'off', {}],
        ['unreadable row', focusSaved({ state: 'query_error', sessionId: undefined, userId: undefined }), 'off', {}],
    ] as const)('%s → null', (_name, saved, mode, over) => {
        expect(product(saved, mode, over)).toBeNull();
    });

    it('a wrong-product metrics-only row is passed through, so the switch verdict still FAILs it by name', () => {
        const p = product(focusSaved({ product: 'open_mic' }), 'off');
        expect(p).toBe('open_mic');
        expect(switchIsolationVerdict(saveOff(p))).toMatchObject({ verdict: 'FAIL', detail: 'the take after the switch was not saved as Focus Points' });
    });
});

describe('#1897 Codex P2 — the journey derives the switch product through the consent-aware read', () => {
    const src = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
    it('uses switchSavedFocusProduct with the run\'s saving choice, the exact Focus take and the run owner', () => {
        expect(src).toMatch(/const savedProduct = switchSavedFocusProduct\(\{ saved: savedFocus, focusId: focusId && focusId !== openMicId \? focusId : null,\s*ownerId: owner\.uid, transcriptSaving: switchSavingOff \? 'off' : 'on' \}\);/);
    });
    it('no longer reads the product from an "available only" row', () => {
        expect(src).not.toMatch(/savedFocus\.state === 'available'/);
    });
});
