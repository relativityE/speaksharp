// AHT-02 / AHT-03 probe-save-isolation and same-target-numeric (Sam, #1811 RETURN on d1487bdb, item 1). The Focus journey
// calls #1812's own helpers with Focus's OWN design: two no-save probes (so never the helper's all-saved default) and the captured
// saved ids in press order; and the harness's numeric adapter with the attempt bound to THIS repeat. These controls drive the real
// shared helper and the real adapter (read-only imports; neither is edited here).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { probeSaveIsolationRow, type TakeBindings } from '../live/helpers/rwtHarnessParity';
import { AHT02_DESIGNED_SAVES, AHT03_DESIGNED_SAVES, focusCapturedTakes, focusDesignedSaves, type SaveExpectation } from '../live/helpers/rwtFocusSaveIsolation';

const here = path.dirname(fileURLToPath(import.meta.url));
const journey = readFileSync(path.join(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');

type Verdict = 'PASS' | 'FAIL' | 'HOLD';
const sink = () => {
    const rows: Array<{ step: string; verdict: Verdict; detail: string }> = [];
    return { rows, row: (step: string, verdict: Verdict, detail: string) => { rows.push({ step, verdict, detail }); } };
};
const admin = (rows: Array<{ id: string; lease_id: string | null }>) =>
    ({ from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: rows, error: null }) }) }) }) });

/** A run of the design: each saved take k has session `s<k>` under lease `L<k>`; probes have none. */
function run(design: readonly SaveExpectation[]) {
    const leases = design.map((_, k) => `L${k}`);
    const rows = design.flatMap((x, k) => x === 'saved' ? [{ id: `s${k}`, lease_id: leases[k] }] : []);
    const bindings: TakeBindings = { takes: design.map((x, k) => ({ control: 'mic-start' as const, ids: x === 'saved' ? [`s${k}`] : [] })), stray: [] };
    const captured = rows.map((r) => r.id);
    return { leases, rows, bindings, captured };
}
async function judge(o: { rows: Array<{ id: string; lease_id: string | null }>; bindings: TakeBindings; leases: string[]; captured: Array<string | null> },
    design: readonly SaveExpectation[] | undefined, designed: number): Promise<Verdict> {
    const r = sink();
    await probeSaveIsolationRow(r, admin(o.rows) as never, 'owner', o.captured, o.bindings, o.leases, designed, design);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].step).toBe('probe saves isolated');
    return r.rows[0].verdict;
}

describe('Focus save design', () => {
    it('AHT-03: two saved takes then two no-save probes; AHT-02 adds three saved takes', () => {
        expect(AHT03_DESIGNED_SAVES).toEqual(['saved', 'saved', 'probe', 'probe']);
        expect(AHT02_DESIGNED_SAVES).toEqual(['saved', 'saved', 'probe', 'probe', 'saved', 'saved', 'saved']);
        expect(focusDesignedSaves('focus_points_tts')).toBe(AHT02_DESIGNED_SAVES);
        expect(focusDesignedSaves('focus_points_partial_tts')).toBe(AHT03_DESIGNED_SAVES);
    });
    it('the design has one entry per designed Start press (the journey\'s own press budgets)', () => {
        const total = (name: string) => Number(new RegExp(`const ${name}: StartPressBudget = \\{ total: (\\d+)`).exec(journey)?.[1]);
        expect(total('AHT02_START_PRESS_BUDGET')).toBe(AHT02_DESIGNED_SAVES.length);
        expect(total('AHT03_START_PRESS_BUDGET')).toBe(AHT03_DESIGNED_SAVES.length);
    });
    it('captured ids are the saved takes in press order, and a missing one stays in place as null', () => {
        const t = { first: 'a', repeat: 'b', switchOpenMic: 'c', switchFocus: 'd', edited: 'e' };
        expect(focusCapturedTakes('focus_points_tts', t)).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(focusCapturedTakes('focus_points_partial_tts', t)).toEqual(['a', 'b']);
        expect(focusCapturedTakes('focus_points_tts', { ...t, switchOpenMic: null })).toEqual(['a', 'b', null, 'd', 'e']);
        for (const f of ['focus_points_tts', 'focus_points_partial_tts']) {
            expect(focusCapturedTakes(f, t)).toHaveLength(focusDesignedSaves(f).filter((x) => x === 'saved').length);
        }
    });
});

describe('probe-save-isolation with Focus\'s design (the real #1812 helper)', () => {
    for (const [name, design] of [['AHT-03', AHT03_DESIGNED_SAVES], ['AHT-02', AHT02_DESIGNED_SAVES]] as const) {
        it(`${name}: a clean run passes only with Focus's explicit expectations`, async () => {
            const o = run(design);
            expect(await judge(o, design, design.length)).toBe('PASS');
            // Negative control: inheriting the helper's all-saved default does not qualify Focus's two no-save probes.
            expect(await judge(o, undefined, design.length)).not.toBe('PASS');
        });
        it(`${name}: a no-save probe that saved fails`, async () => {
            const o = run(design);
            const probe = design.indexOf('probe');
            expect(await judge({ ...o, rows: [...o.rows, { id: 'leak', lease_id: o.leases[probe] }] }, design, design.length)).toBe('FAIL');
            expect(await judge({ ...o, rows: [...o.rows, { id: 'leak', lease_id: o.leases[probe + 1] }] }, design, design.length)).toBe('FAIL');
            const observed = { ...o.bindings, takes: o.bindings.takes.map((t, k) => k === probe ? { ...t, ids: ['leak'] } : t) };
            expect(await judge({ ...o, bindings: observed }, design, design.length)).toBe('FAIL');
        });
        it(`${name}: a saved take that saved nothing fails`, async () => {
            const o = run(design);
            const last = design.lastIndexOf('saved');
            expect(await judge({ ...o, rows: o.rows.filter((r) => r.lease_id !== o.leases[last]) }, design, design.length)).toBe('FAIL');
        });
        it(`${name}: captured ids out of press order fail; a missing capture holds`, async () => {
            const o = run(design);
            expect(await judge({ ...o, captured: [o.captured[1], o.captured[0], ...o.captured.slice(2)] }, design, design.length)).toBe('FAIL');
            expect(await judge({ ...o, captured: [o.captured[0], null, ...o.captured.slice(2)] }, design, design.length)).toBe('HOLD');
            // Dropping a capture (instead of keeping its place) can never pass: the count no longer matches the saved takes.
            expect(await judge({ ...o, captured: o.captured.slice(0, -1) }, design, design.length)).toBe('HOLD');
        });
        it(`${name}: a stray save or an extra take fails`, async () => {
            const o = run(design);
            expect(await judge({ ...o, bindings: { ...o.bindings, stray: ['stray'] } }, design, design.length)).toBe('FAIL');
            expect(await judge({ ...o, leases: [...o.leases, 'Lx'], bindings: { ...o.bindings, takes: [...o.bindings.takes, { control: 'mic-start', ids: [] }] } }, design, design.length)).toBe('FAIL');
        });
    }
    it('the AHT-03 design never stands in for AHT-02 (wrong design length holds)', async () => {
        const o = run(AHT02_DESIGNED_SAVES);
        expect(await judge(o, AHT03_DESIGNED_SAVES, AHT02_DESIGNED_SAVES.length)).toBe('HOLD');
    });
});

describe('same-target-numeric: the attempt bound to this repeat (the real harness adapter)', () => {
    const numeric = createRequire(import.meta.url)(path.join(here, '../../tools/cloud-test/harness/draft-adapters/progress-numeric.cjs')) as {
        SOURCE_SHA: string;
        readExpected: (a: Record<string, unknown>) => Promise<{ result?: string; facts?: { reason?: string } }>;
    };
    const rec = { id: 'rec', user_id: 'owner', source_session_id: 'src', formula_version: 'clarity_v1', target_metric: 'pace', target_direction: 'decrease',
        target_value: 150, target_units: 'wpm', source_metric_value: 170, shown_text: 'Slow down.' };
    const attempt = (id: string) => ({ id, user_id: 'owner', recommendation_id: 'rec', practice_session_id: 'rep', next_comparable_session_id: 'rep',
        lifecycle: 'completed', outcome: 'moved', accepted_at: '2026-11-12T00:00:00Z' });
    const db = (attempts: unknown[]) => {
        const q = (data: unknown) => {
            const chain = { select: () => chain, eq: () => chain, order: () => chain, maybeSingle: async () => ({ data, error: null }),
                limit: async () => ({ data, error: null }) };
            return chain;
        };
        return { from: (t: string) => t === 'progress_recommendations' ? q(rec) : t === 'progress_recommendation_attempts' ? q(attempts) : q(null) };
    };
    const config = { sourceSha: numeric.SOURCE_SHA, servedSha: numeric.SOURCE_SHA, account: { id: 'owner' } };
    it('an attempt other than the one bound to this repeat fails; without the bound id that check cannot fire', async () => {
        const stale = await numeric.readExpected({ db: db([attempt('other')]), caseConfig: config, sourceSessionId: 'src', repeatSessionId: 'rep', expectedAttemptId: 'bound' });
        expect(stale).toMatchObject({ result: 'FAIL', facts: { reason: 'stale-or-wrong-repeat-attempt' } });
        const unbound = await numeric.readExpected({ db: db([attempt('other')]), caseConfig: config, sourceSessionId: 'src', repeatSessionId: 'rep' });
        expect(unbound.facts?.reason).not.toBe('stale-or-wrong-repeat-attempt');
    });
    it('the same session as source and repeat, or an unrevalidated release, is NOT RUN (held), never a pass', async () => {
        await expect(numeric.readExpected({ db: db([]), caseConfig: config, sourceSessionId: 'src', repeatSessionId: 'src' })).rejects.toMatchObject({ code: 'NOT_RUN' });
        await expect(numeric.readExpected({ db: db([]), caseConfig: { ...config, servedSha: 'other' }, sourceSessionId: 'src', repeatSessionId: 'rep' })).rejects.toMatchObject({ code: 'NOT_RUN' });
    });
});

describe('Focus journey wiring', () => {
    const at = (needle: string) => { const i = journey.indexOf(needle); expect({ needle, found: i >= 0 }).toEqual({ needle, found: true }); return i; };
    it('probe-save-isolation runs with Focus\'s own expectations and captured ids, before the account is deleted', () => {
        expect(journey).toMatch(/probeSaveIsolationRow\(aliveReceipt\(receipt, alive\), admin as never, owner\.uid, captured, parity\.takeBindings\(\), parity\.leaseIds, designed\.length, designed\)/);
        expect(journey).toMatch(/const designed = focusDesignedSaves\(fixtureKey\);/);
        expect(journey).toMatch(/focusCapturedTakes\(fixtureKey, \{ first: persistedId, repeat: repeatSessionId, switchOpenMic: switchOpenMicId, switchFocus: switchFocusTakeId, edited: editedTakeId \}\)/);
        expect(at("steps.step('probe saves isolated'")).toBeGreaterThan(at("steps.step('harness parity counts'"));
        expect(at("steps.step('probe saves isolated'")).toBeLessThan(at('cleanupRunOwnedAccount({'));
    });
    it('each later saved take is captured where it saved, and only as a new session', () => {
        expect(journey).toMatch(/switchOpenMicId = savedOpenMicId;/);
        expect(journey).toMatch(/switchFocusTakeId = switchFocusId;/);
        expect(journey).toMatch(/editedTakeId = takeBId && takeBId !== predecessor && takeBId !== persistedId \? takeBId : null;/);
    });
    it('the numeric row uses the harness adapter (no copy) on the opened panel, with the bound attempt, and closes the panel', () => {
        const step = journey.slice(at("test.step('saved and displayed comparison numbers match'"), at("// ── #1258 Focus-only"));
        expect(step).toContain("draft-adapters/progress-numeric.cjs");
        expect(step).toMatch(/expectedAttemptId: boundAttemptId/);
        expect(step).toMatch(/page: panelPage, db: admin, sourceSessionId: persistedId, repeatSessionId/);
        expect(step).toMatch(/numericComparisonRow\(receipt, result, repeatEligibility\)/);
        expect(step).toMatch(/finally \{\s*await progressPanelTab\?\.close\(\)/);
        expect(step).not.toMatch(/goto\(/);
        expect(at("test.step('saved and displayed comparison numbers match'")).toBeGreaterThan(at("test.step('the repeat result names the measured metric'"));
        expect(journey).toMatch(/boundAttemptId = bound\?\.length === 1 \? bound\[0\]\.id as string : null;/);
        expect(journey).toMatch(/progressPanelTab = tab;/);
    });
});
