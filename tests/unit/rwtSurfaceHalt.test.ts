// @vitest-environment node
/**
 * PM 5881740741 — rehearsal 1 (run 36506361220) HOLDed at the surface preflight, before any Production write, yet its
 * receipt reported five product FAILs built from the aborted journey's zero counts. A pre-write halt must leave every
 * later row HOLD "not reached" and acceptance INCOMPLETE. The RWT entry points must also run on the clean fixture.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    RUN_OWNED_CLEANUP_ROW, receiptAcceptance, recordRunOwnedCleanup, rowAfterHalt, type ReceiptRow,
} from '../live/helpers/rwtAcceptance';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const HALT = 'surface preflight';

/** Rows recorded after the halt: the shapes the Open Mic `finally` block wrote in run 36506361220. */
const afterHalt: ReceiptRow[] = [
    { step: 'telemetry decodable', verdict: 'FAIL', detail: 'every analytics body decoded', evidence: { events: 0, undecodable: 0 } },
    { step: 'journey telemetry (canary class)', verdict: 'HOLD', detail: 'the canary claim was not authorized for this run; no journey is readback-eligible' },
    { step: 'telemetry sent', verdict: 'FAIL', detail: 'session_saved and feedback_submit left the page (sent, not yet received)', evidence: { sessionSaved: 0, feedbackSubmit: 0 } },
    { step: 'revisit is not a generation', verdict: 'FAIL', detail: 'the generation count is not exactly one for this take', evidence: { reviewGenerationsRequested: 0 } },
    { step: 'receipt content-free', verdict: 'PASS', detail: 'no credential, email or coaching text in the receipt' },
];

describe('a pre-write surface HOLD halts the receipt', () => {
    const halted = [
        { step: 'base_q4 primary', verdict: 'HOLD' as const, detail: 'recorded before the preflight' },
        { step: HALT, verdict: 'HOLD' as const, detail: 'HOLD before any Production write: a test/mock injection surface is present' },
        ...afterHalt.map((r) => rowAfterHalt(r, HALT)),
    ];

    it('rows after the halt are HOLD "not reached" and carry no zero-count evidence; no product FAIL remains', () => {
        for (const r of halted.slice(2, -1)) {
            expect(r).toEqual({ step: r.step, verdict: 'HOLD', detail: `not reached: the journey stopped at ${HALT}` });
        }
        expect(halted.filter((r) => r.verdict === 'FAIL')).toEqual([]);
    });

    it('acceptance is INCOMPLETE, never FAIL or PASS, and the automated part is not all-pass', () => {
        const a = receiptAcceptance(halted);
        expect(a.acceptance).toBe('INCOMPLETE');
        expect(a.automatedRowsAllPass).toBe(false);
    });

    it('the receipt leak check stays a real verdict after the halt (it judges the receipt, not the product)', () => {
        const leak: ReceiptRow = { step: 'receipt content-free', verdict: 'FAIL', detail: 'the receipt carried a forbidden value' };
        expect(rowAfterHalt(leak, HALT)).toBe(leak);
        expect(receiptAcceptance([...halted, rowAfterHalt(leak, HALT)]).acceptance).toBe('FAIL');
    });

    it('without a halt, rows are recorded unchanged — a real FAIL is still a FAIL', () => {
        for (const r of afterHalt) expect(rowAfterHalt(r, null)).toBe(r);
        expect(receiptAcceptance(afterHalt).acceptance).toBe('FAIL');
    });
});

describe('run-owned cleanup after a halt', () => {
    const collect = () => {
        const out: ReceiptRow[] = [];
        return { out, row: (step: string, verdict: ReceiptRow['verdict'], detail: string, evidence?: ReceiptRow['evidence']) => { out.push({ step, verdict, detail, evidence }); } };
    };

    it('"no account to delete" is expected after a pre-write halt: HOLD not reached, not a FAIL', async () => {
        const { out, row } = collect();
        await recordRunOwnedCleanup(row, async () => '');
        expect(out[0]).toMatchObject({ step: RUN_OWNED_CLEANUP_ROW, verdict: 'FAIL', evidence: { cleanupOutcome: 'none_found' } });
        expect(rowAfterHalt(out[0], HALT).verdict).toBe('HOLD');
    });

    it('CASUALTY: a cleanup that failed or found residue stays a FAIL even after a halt', async () => {
        const { out, row } = collect();
        await recordRunOwnedCleanup(row, async () => { throw new Error('residue'); });
        expect(out[0]).toMatchObject({ verdict: 'FAIL', evidence: { cleanupOutcome: 'failed' } });
        expect(rowAfterHalt(out[0], HALT)).toBe(out[0]);
    });

    it('a verified deletion stays PASS after a halt', async () => {
        const { out, row } = collect();
        await recordRunOwnedCleanup(row, async () => 'uid-1');
        expect(rowAfterHalt(out[0], HALT)).toBe(out[0]);
    });
});

describe('RWT entry points run on the clean Production fixture and halt through the shared preflight', () => {
    const ENTRY_POINTS = [
        'tests/live/rwt-open-mic-first-session.live.spec.ts',
        'tests/live/rwt-focus-points-session.live.spec.ts',
        'tests/live/rwt-focus-points-partial.live.spec.ts',
        'tests/live/rwt-products-navigation.live.spec.ts',
        'tests/live/helpers/rwtFocusPointsJourney.ts',
    ];

    it.each(ENTRY_POINTS)('%s imports test from rwtProductionTest, never deployedLiveTest', (file) => {
        const src = read(file);
        expect(src).toMatch(/import \{ test \} from '\.\/(helpers\/)?rwtProductionTest';/);
        expect(src).not.toMatch(/deployedLiveTest/);
    });

    it('each spec reaches the fixture: the Focus Points specs through rwtFocusPointsJourney', () => {
        for (const spec of ['tests/live/rwt-focus-points-session.live.spec.ts', 'tests/live/rwt-focus-points-partial.live.spec.ts']) {
            expect(read(spec)).toMatch(/from '\.\/helpers\/rwtFocusPointsJourney'/);
        }
    });

    it('the RWT fixture injects nothing into the page', () => {
        const src = read('tests/live/helpers/rwtProductionTest.ts').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(src).not.toMatch(/addInitScript|__E2E|__MOCK|__MSW|TEST_MODE/);
    });

    it.each(['tests/live/rwt-open-mic-first-session.live.spec.ts', 'tests/live/rwt-products-navigation.live.spec.ts', 'tests/live/helpers/rwtFocusPointsJourney.ts'])(
        '%s runs the surface preflight through requireApprovedSurface (which halts the receipt)', (file) => {
            const src = read(file);
            expect(src).toMatch(/await requireApprovedSurface\(page, receipt\);/);
            expect(src).not.toMatch(/approvedSurfaceFailures\(/);
        });
});
