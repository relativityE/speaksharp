// #1882 — binds the Focus journey's switch take to the live-clock hold and the four-row rail rule. Reads source only (no new
// imports), so on a build without the fix it fails on the journey itself: the take is still timed from the Start click.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');

/** The switch take: from its Start press to the switch verdict. */
const switchTake = (() => {
    const start = src.indexOf('await startBenchmarkRecording(page, `${suite}-switch-focus`);');
    const verdict = src.indexOf('const iso = switchIsolationVerdict({', start);
    return start > 0 && verdict > start ? src.slice(start, src.indexOf('});', verdict)) : '';
})();
const stop = switchTake.indexOf('await stopBenchmarkRecording(page, `${suite}-switch-focus`');

describe('#1882 — the Focus switch take in the journey', () => {
    it('is found', () => {
        expect(switchTake.length).toBeGreaterThan(0);
        expect(stop).toBeGreaterThan(0);
    });

    it('is held on the live clock between Start and Stop, never a bare wall-clock wait from the click', () => {
        const held = switchTake.slice(0, stop);
        expect(held).toMatch(/await holdLiveTake\(page, shortTakeSeconds, switchPressedAt\);/);
        expect(held).not.toMatch(/waitForTimeout\(/);
        // The press time is read before the press, so the receipt's press-to-live delay includes it.
        expect(src.indexOf('const switchPressedAt = Date.now();')).toBeLessThan(src.indexOf('await startBenchmarkRecording(page, `${suite}-switch-focus`);'));
    });

    it('waits for the rail to settle on four actual rows, not on "nothing pending"', () => {
        const after = switchTake.slice(stop);
        expect(after).toMatch(/railSettled\(await readRailRowCount\(page\), \(await readRail\(page, points\.length\)\)\.statuses, points\.length\)/);
        expect(after).not.toMatch(/\.statuses\.every\(\(s\) => s !== 'pending'\)/);
    });

    it('passes the actual row count to the verdict and records the live hold on the receipt row', () => {
        expect(src).toMatch(/savedProduct, finalStatuses, railRowCount, staleCoachingBeforeStart, markerSupport,/);
        expect(src).toMatch(/pressToLiveMs: switchTake\.pressToLiveMs, heldLiveSeconds: switchTake\.heldLiveSeconds,/);
    });
});
