// #1882 — every Focus take in the journey waits for its rail to settle on its actual rows, never on "nothing pending".
// The switch take was fixed first; the first take (row 11) and the edited-set take had the same poll. An absent row reads
// null, and null is not 'pending', so `statuses.every((s) => s !== 'pending')` settled at once on an EMPTY rail and the
// row read four nulls: a harness timing FAIL reported as a product verdict. Reads source only, so on a build without the
// fix it fails on the journey itself.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { railSettled } from '../live/helpers/rwtLiveTimedTake';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');

/** The source between two markers (exclusive of the end marker); empty when either is missing or out of order. */
const between = (from: string, to: string): string => {
    const a = src.indexOf(from);
    const b = a < 0 ? -1 : src.indexOf(to, a);
    return a >= 0 && b > a ? src.slice(a, b) : '';
};

/** Row 11, the first Focus take: from its save to the first read of its final rail. */
const firstTake = between('receipt.row(\'session saved\'', 'firstTakeRail = final;');
/** The take on the edited set: from its save to the read of its ordered rail. */
const editedTake = between('takeBId = !editedStop.pressed || editedOutcome.kind === \'too_short\' ? null : await waitForNewPersistedSession(page, predecessor);', 'railOrdered = await Promise.all(');

describe('#1882 — the first and edited Focus takes settle on actual rail rows', () => {
    it('both takes are found', () => {
        expect(firstTake.length).toBeGreaterThan(0);
        expect(editedTake.length).toBeGreaterThan(0);
    });

    it('the first take waits for four actual rows, none pending, before reading its final verdicts', () => {
        expect(firstTake).toMatch(/railSettled\(await readRailRowCount\(page\), \(await readRail\(page, points\.length\)\)\.statuses, points\.length\)/);
        expect(firstTake).not.toMatch(/\.statuses\.every\(\(s\) => s !== 'pending'\)/);
    });

    it('the edited take waits for the edited set\'s actual rows, none pending, before reading its ordered rail', () => {
        expect(editedTake).toMatch(/railSettled\(await readRailRowCount\(page\), \(await readRail\(page, edited\.length\)\)\.statuses, edited\.length\)/);
        expect(editedTake).not.toMatch(/\.statuses\.every\(\(s\) => s !== 'pending'\)/);
    });

    it('no settle poll anywhere in the journey still accepts an empty rail', () => {
        expect(src).not.toMatch(/\.statuses\.every\(\(s\) => s !== 'pending'\)/);
    });
});

describe('#1882 — why: a rail that renders its rows after Stop', () => {
    // Reads of the first take's rail as the review renders: empty, still empty, then four settled rows.
    const reads: Array<{ rows: number; statuses: (string | null)[] }> = [
        { rows: 0, statuses: [null, null, null, null] },
        { rows: 0, statuses: [null, null, null, null] },
        { rows: 4, statuses: ['covered', 'partial', 'missing', 'missing'] },
    ];
    const settlesAt = (settled: (r: { rows: number; statuses: (string | null)[] }) => boolean) => reads.findIndex(settled);

    it('the old rule settles on the first, empty read and would grade four nulls', () => {
        const old = (r: { statuses: (string | null)[] }) => r.statuses.every((s) => s !== 'pending');
        expect(settlesAt(old)).toBe(0);
        expect(reads[settlesAt(old)].statuses).toEqual([null, null, null, null]);
    });

    it('railSettled waits for the read with four actual rows', () => {
        const i = settlesAt((r) => railSettled(r.rows, r.statuses, 4));
        expect(i).toBe(2);
        expect(reads[i].statuses).toEqual(['covered', 'partial', 'missing', 'missing']);
    });
});
