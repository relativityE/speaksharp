// #1882 — binds every Focus take in the journey to a MEASURED live hold (Sam's Nov 18 reset, row 3.1): the take monitor is
// armed before the press, the hold is counted from the page's own capture-live edge and ends early if capture drops or the
// take changes, and each take's receipt rows come from what the page recorded through the actual Stop. Reads source only (no
// new imports), so on a build without the fix it fails on the journey itself: the takes are timed from the Start click.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');

const between = (from: string, to: string): string => {
    const a = src.indexOf(from);
    const b = a < 0 ? -1 : src.indexOf(to, a);
    return a >= 0 && b > a ? src.slice(a, b) : '';
};

/** The switch take: from the line before its Start press to the switch verdict. */
const switchTake = between('const switchPressedAt = Date.now();', 'const iso = switchIsolationVerdict({');
const switchStop = switchTake.indexOf('await stopBenchmarkRecording(page, `${suite}-switch-focus`');
/** The edited-set take: from its Start press to its rail settle. */
const editedTake = between('const editedPressedAt = Date.now();', 'railSettled(await readRailRowCount(page), (await readRail(page, edited.length)).statuses, edited.length)');
const editedStop = editedTake.indexOf('await stopBenchmarkRecording(page, `${suite}-edited`');
/** The first take: from the model setup to its final rail read. */
const firstTake = between('firstTakeMonitor = await armTakeMonitor(page, suite);', 'firstTakeRail = final;');

describe('#1882 — every Focus take is measured live through its own Stop', () => {
    it('all three takes are found', () => {
        expect(switchStop).toBeGreaterThan(0);
        expect(editedStop).toBeGreaterThan(0);
        expect(firstTake.length).toBeGreaterThan(0);
    });

    it('the switch take: armed before the press, held on the measured live clock, never a bare wait from the click', () => {
        expect(src.indexOf('const switchMonitor = await armTakeMonitor(page, `${suite}-switch-focus`);'))
            .toBeLessThan(src.indexOf('await startBenchmarkRecording(page, `${suite}-switch-focus`);'));
        const held = switchTake.slice(0, switchStop);
        expect(held).toMatch(/await holdMeasuredLiveTake\(page, switchMonitor, shortTakeSeconds, \{ nodePressedAt: switchPressedAt \}\);/);
        expect(held).not.toMatch(/waitForTimeout\(|holdLiveTake\(/);
    });

    it('the switch take: its outcome and receipt rows come from the page through the actual Stop', () => {
        const after = switchTake.slice(switchStop);
        expect(after).toMatch(/await awaitTakeOutcome\(page, switchMonitor\.token, 180_000\)/);
        expect(after).toMatch(/await measuredTakeRows\('Focus switch take', switchMonitor, shortTakeSeconds, switchPressedAt,/);
        expect(src).toMatch(/pressToLiveMs: switchTake\.timing\.pressToLiveMs, liveSecondsAtStop: switchTake\.timing\.liveSecondsAtStop,/);
        expect(src).not.toMatch(/heldLiveSeconds/);
    });

    it('the edited take: the click-timed wait is gone; armed before the press and measured from live', () => {
        expect(src.indexOf('const editedMonitor = await armTakeMonitor(page, `${suite}-edited`);'))
            .toBeLessThan(src.indexOf('await startBenchmarkRecording(page, `${suite}-edited`);'));
        const held = editedTake.slice(0, editedStop);
        expect(held).toMatch(/await holdMeasuredLiveTake\(page, editedMonitor, fixture\.entry\.speechSeconds \+ 10, \{ nodePressedAt: editedPressedAt \}\);/);
        expect(held).not.toMatch(/waitForTimeout\(/);
        expect(editedTake.slice(editedStop)).toMatch(/await measuredTakeRows\('Focus edited take', editedMonitor, fixture\.entry\.speechSeconds \+ 10, editedPressedAt,/);
    });

    it('the first take: armed before anything that may press Start, and measured for the whole spoken fixture', () => {
        expect(firstTake.indexOf('await selectBenchmarkMode(page, \'private\');')).toBeGreaterThan(0);
        expect(firstTake).toMatch(/firstPressedAt = Date\.now\(\);\n\s*await startBenchmarkRecording\(page, suite\);/);
        expect(firstTake).toMatch(/await awaitTakeOutcome\(page, firstTakeMonitor\.token, 180_000\)/);
        expect(firstTake).toMatch(/await measuredTakeRows\('Focus first take', firstTakeMonitor, fixture\.entry\.speechSeconds, firstPressedAt, persistedId\)/);
    });

    it('consent is settled on the first Practice visit, before any take, and every saved take is read back against it', () => {
        const settle = src.indexOf('consent = await settlePracticeConsent({');
        expect(settle).toBeGreaterThan(0);
        expect(settle).toBeLessThan(src.indexOf('firstTakeMonitor = await armTakeMonitor(page, suite);'));
        expect(src).toMatch(/readback: \(row, sessionId, liveSecondsAtStop\) => consentReadbackVerdict\(\{ build: consent\.build, choice: consent\.choice, row, ownerId: owner\.uid,/);
    });

    it('waits for the rail to settle on four actual rows, not on "nothing pending"', () => {
        const after = switchTake.slice(switchStop);
        expect(after).toMatch(/railSettled\(await readRailRowCount\(page\), \(await readRail\(page, points\.length\)\)\.statuses, points\.length\)/);
        expect(after).not.toMatch(/\.statuses\.every\(\(s\) => s !== 'pending'\)/);
        expect(src).toMatch(/savedProduct, finalStatuses, railRowCount, staleCoachingBeforeStart, markerSupport,/);
    });
});
