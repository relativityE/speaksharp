// AHT-02 / AHT-03 `next point marked` (catalog focus-next-point-marked). Owner decision (Akin, 2026-11-11): the "Still to cover"
// marker must always be on the FIRST pending point; it is not required to move. The verdict mirrors the harness `markerVerdict`
// (tools/cloud-test/harness/draft-adapters/focus-oracle.cjs, read-only), and the parity block runs both over the same timelines.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import {
    ABSENT_ROW, MARKER_TIMELINE_CAP, MarkerTimeline, expectedNextMarker, nextPointMarkedVerdict, sampleFocusRail,
    type MarkerObservation, type MarkerSample,
} from '../live/helpers/rwtFocusNextMarker';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const harness = require(path.resolve(here, '../../tools/cloud-test/harness/draft-adapters/focus-oracle.cjs')) as {
    markerVerdict: (o: unknown) => { result: 'PASS' | 'FAIL' | 'NOT RUN'; facts: { resultBasis: string } };
};

const P = 'pending', PA = 'partial', C = 'covered';
const observed = (timeline: MarkerSample[], over: Partial<MarkerObservation> = {}): MarkerObservation =>
    ({ frozen: true, samples: 40, unreadable: 0, timeline, multiMarker: [], ...over });

/** A correct rail whose marker moves as points are heard. */
const MOVING: MarkerSample[] = [[0, 0, [P, P, P, P]], [5000, 1, [C, P, P, P]], [10000, 2, [C, C, P, P]], [15000, 3, [C, C, PA, P]]];
/** A correct rail whose opening point stays pending while later points are heard: the marker never moves (GAP-02 shape). */
const STEADY: MarkerSample[] = [[0, 0, [P, P, P, P]], [12003, 0, [P, P, PA, P]], [23501, 0, [P, P, PA, C]]];

const CASES: Array<[string, 'PASS' | 'FAIL' | 'HOLD', MarkerObservation | null]> = [
    ['marker on the first pending point, moving', 'PASS', observed(MOVING)],
    ['marker never moves but is always on the first pending point', 'PASS', observed(STEADY)],
    ['marker stuck on a covered point', 'FAIL', observed([[0, 0, [P, P, P, P]], [5000, 0, [C, P, P, P]]])],
    ['marker stuck on a partial point', 'FAIL', observed([[0, 0, [P, P, P, P]], [5000, 0, [PA, P, P, P]]])],
    ['marker on a later pending point', 'FAIL', observed([[0, 0, [P, P, P, P]], [5000, 2, [P, C, P, P]]])],
    ['marker jumps past the first pending point', 'FAIL', observed([[0, 1, [P, P, P, P]]])],
    ['no marker while a point is pending', 'FAIL', observed([[0, null, [P, P, P, P]]])],
    ['marker shown when nothing is pending', 'FAIL', observed([[0, 0, [P, P, P, P]], [5000, 3, [C, C, C, C]]])],
    ['two markers in one sample', 'FAIL', observed(STEADY, { multiMarker: [[5000, 2]] })],
    ['no samples: no window', 'HOLD', null],
    ['no samples: zero reads', 'HOLD', observed([], { samples: 0 })],
    ['no samples: empty timeline', 'HOLD', observed([])],
    ['a read failed', 'HOLD', observed(MOVING, { unreadable: 1 })],
    ['window not frozen', 'HOLD', observed(MOVING, { frozen: false })],
    ['only inconclusive samples (a final status during speech)', 'HOLD', observed([[0, 0, [P, 'missing', P, P]]])],
    ['only all-covered samples, correctly unmarked', 'HOLD', observed([[0, null, [C, C, C, C]]])],
    ['a status went backwards (no marker defect)', 'HOLD', observed([[0, 0, [P, C, P, P]], [1000, 0, [P, P, P, P]]])],
    ['a real marker defect is not hidden by a contradiction', 'FAIL', observed([[0, 0, [P, C, P, P]], [1000, 2, [P, P, P, P]]])],
    ['timestamps went backwards', 'HOLD', observed([[5000, 0, [P, P, P, P]], [1000, 0, [P, P, PA, P]]])],
    ['truncated timeline (reached the cap)', 'HOLD', observed(Array.from({ length: MARKER_TIMELINE_CAP }, (_, i): MarkerSample => [i, 0, [P, P]]))],
];

describe('nextPointMarkedVerdict — first pending point, movement not required', () => {
    it.each(CASES)('%s → %s', (_, expected, o) => {
        expect(nextPointMarkedVerdict(o).verdict).toBe(expected);
    });

    it('PASS names the owner rule and that movement is not required; the old movement read is diagnostic only', () => {
        const r = nextPointMarkedVerdict(observed(STEADY));
        expect(r.basis).toBe('marker-consistent');
        expect(r.evidence.movementRequired).toBe(false);
        expect(r.evidence.markerSequence).toBe('0');
        expect(r.evidence.oracle).toBe('marker-on-first-uncovered-point');
    });

    it('FAIL names the first wrong sample: when, where the marker was and where it should have been', () => {
        const r = nextPointMarkedVerdict(observed([[0, 0, [P, P, P, P]], [5000, 0, [C, P, P, P]], [9000, 0, [C, C, P, P]]]));
        expect(r.basis).toBe('marker-wrong');
        expect(r.evidence).toMatchObject({ firstInconsistentMs: 5000, firstInconsistentMarker: 0, firstInconsistentExpected: 1, inconsistentStates: 2 });
        const none = nextPointMarkedVerdict(observed([[0, null, [C, P, P, P]]]));
        expect(none.evidence).toMatchObject({ firstInconsistentMarker: 'none', firstInconsistentExpected: 1 });
        const allDone = nextPointMarkedVerdict(observed([[0, 2, [C, C, C, C]]]));
        expect(allDone.evidence).toMatchObject({ markerShownWhileAllCovered: true, firstInconsistentExpected: 'none' });
    });

    it('the receipt evidence is content-free scalars (ordinals, closed status prefixes, ms) and bounded', () => {
        const long = Array.from({ length: 120 }, (_, i): MarkerSample => [i * 500, 0, [P, i % 2 ? PA : P, P, P]]);
        const r = nextPointMarkedVerdict(observed(long));
        for (const v of Object.values(r.evidence)) expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true);
        expect(String(r.evidence.timeline).split(' ')).toHaveLength(40);
        expect(String(r.evidence.timeline)).toMatch(/^0:0:pepepepe /);
    });

    it('expectedNextMarker is the first pending row; partial and covered never carry the marker', () => {
        expect(expectedNextMarker([C, PA, P, P])).toBe(2);
        expect(expectedNextMarker([C, PA, C, C])).toBeNull();
    });
});

describe('parity with the harness markerVerdict (focus-oracle.cjs)', () => {
    const toHarness = (v: 'PASS' | 'FAIL' | 'HOLD') => (v === 'HOLD' ? 'NOT RUN' : v);
    it.each(CASES)('%s (ours %s): same result as the harness', (_, _expected, o) => {
        const mine = nextPointMarkedVerdict(o);
        const theirs = harness.markerVerdict(o);
        expect(toHarness(mine.verdict)).toBe(theirs.result);
        expect(mine.basis).toBe(theirs.facts.resultBasis);
    });
});

describe('MarkerTimeline — the live window', () => {
    it('writes an entry only when the (marker, statuses) pair changes; counts every read', () => {
        const t = new MarkerTimeline();
        t.record(0, { statuses: [P, P], markers: [0], unreadableRows: 0 });
        t.record(500, { statuses: [P, P], markers: [0], unreadableRows: 0 });
        t.record(1000, { statuses: [P, C], markers: [0], unreadableRows: 0 });
        const o = t.freeze();
        expect(o).toMatchObject({ frozen: true, samples: 3, unreadable: 0 });
        expect(o.timeline).toEqual([[0, 0, [P, P]], [1000, 0, [P, C]]]);
        expect(nextPointMarkedVerdict(o).verdict).toBe('PASS');
    });

    it('a failed read or an absent row is unreadable, so the window HOLDs rather than PASSes', () => {
        const failed = new MarkerTimeline();
        failed.record(0, { statuses: [P, P], markers: [0], unreadableRows: 0 });
        failed.record(500, null);
        expect(nextPointMarkedVerdict(failed.freeze()).verdict).toBe('HOLD');
        const absent = new MarkerTimeline();
        absent.record(0, { statuses: [P, ABSENT_ROW], markers: [0], unreadableRows: 1 });
        expect(nextPointMarkedVerdict(absent.freeze()).verdict).toBe('HOLD');
    });

    it('keeps the first marker as the marked point and records a sample that showed two markers', () => {
        const t = new MarkerTimeline();
        t.record(0, { statuses: [P, P, P], markers: [0, 2], unreadableRows: 0 });
        const o = t.freeze();
        expect(o.timeline[0][1]).toBe(0);
        expect(o.multiMarker).toEqual([[0, 2]]);
        expect(nextPointMarkedVerdict(o).basis).toBe('duplicate-marker');
    });

    it('freeze is idempotent and later reads cannot change the frozen window', () => {
        const t = new MarkerTimeline();
        t.record(0, { statuses: [P], markers: [0], unreadableRows: 0 });
        const first = t.freeze();
        t.record(500, { statuses: [C], markers: [0], unreadableRows: 0 });
        expect(t.freeze()).toBe(first);
        expect(first.samples).toBe(1);
    });
});

describe('sampleFocusRail — one atomic DOM read', () => {
    const page = { evaluate: async (fn: (a: unknown) => unknown, arg: unknown) => fn(arg) } as unknown as Page;
    it('reads every row status and which rows show "Still to cover"; an absent row is unreadable', async () => {
        document.body.innerHTML = `
            <ul><li data-testid="focus-point-0" data-status="covered"><span>A</span><p>Detected</p></li>
            <li data-testid="focus-point-1" data-status="pending"><span>B</span><p> Still to   cover </p></li>
            <li data-testid="focus-point-2" data-status="pending"><span>C</span></li></ul>`;
        expect(await sampleFocusRail(page, 4)).toEqual({ statuses: [C, P, P, ABSENT_ROW], markers: [1], unreadableRows: 1 });
    });
    it('a read that throws is null (unreadable), never a sample', async () => {
        const broken = { evaluate: async () => { throw new Error('page closed'); } } as unknown as Page;
        expect(await sampleFocusRail(broken, 2)).toBeNull();
    });
});

describe('wiring in rwtFocusPointsJourney.ts', () => {
    const src = readFileSync(path.resolve(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
    it('samples the rail inside the live window, judges the frozen window, and writes the row from that verdict', () => {
        const start = src.indexOf('await startBenchmarkRecording(page, suite);');
        const window = src.indexOf('const markerWindow = new MarkerTimeline();');
        const sample = src.indexOf('const now = await sampleFocusRail(page, points.length);');
        const record = src.indexOf('markerWindow.record(atMs - startedAt, now);');
        const judge = src.indexOf('const nextMarker = nextPointMarkedVerdict(markerWindow.freeze());');
        const row = src.indexOf("receipt.row('next point marked', nextMarker.verdict, nextMarker.detail, nextMarker.evidence);");
        const stop = src.indexOf('await stopBenchmarkRecording(page, suite, 180_000);');
        for (const at of [start, window, sample, record, judge, row, stop]) expect(at).toBeGreaterThan(0);
        expect(window).toBeLessThan(start);
        expect(start).toBeLessThan(sample);
        expect(sample).toBeLessThan(record);
        expect(record).toBeLessThan(judge);
        expect(judge).toBeLessThan(row);
        expect(row).toBeLessThan(stop);
    });
    it('the movement rule is gone: no row is judged on the marker moving', () => {
        expect(src).not.toContain('nextSequence.length > 1');
        expect(src.match(/receipt\.row\('next point marked'/g)).toHaveLength(1);
    });
});
