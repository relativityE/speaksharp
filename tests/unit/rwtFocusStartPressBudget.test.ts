// AHT-02 / AHT-03 Start-press budget (harness parity, PO route 2026-11-10): the Focus journey's designed presses stay 7 (full) and
// 4 (partial). This file's own presses are counted by call, so a check added to the journey that only reads the rail or the
// database, or opens and dismisses the Edit dialog, cannot add a press unnoticed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
const count = (re: RegExp) => src.match(re)?.length ?? 0;

describe('Focus journey Start presses match the designed budget', () => {
    it('the budgets are 7 (AHT-02) and 4 (AHT-03), selected by fixture', () => {
        expect(src).toContain("const AHT02_START_PRESS_BUDGET: StartPressBudget = { total: 7, perControl: { 'mic-start': 6, 'mic-download': 1, 'focus-points-retry': 1 } };");
        expect(src).toContain("const AHT03_START_PRESS_BUDGET: StartPressBudget = { total: 4, perControl: { 'mic-start': 3, 'mic-download': 1, 'focus-points-retry': 1 } };");
        expect(src).toContain("const startPressBudget = fixtureKey === 'focus_points_tts' ? AHT02_START_PRESS_BUDGET : AHT03_START_PRESS_BUDGET;");
    });
    it('this file presses Start exactly at the four cited calls (first take, and the full run\'s three extra takes)', () => {
        expect(count(/await startBenchmarkRecording\(/g)).toBe(4);
        expect(count(/await startBenchmarkRecording\(page, suite\);/g)).toBe(1);
        expect(count(/await startBenchmarkRecording\(page, `\$\{suite\}-switch-openmic`\);/g)).toBe(1);
        expect(count(/await startBenchmarkRecording\(page, `\$\{suite\}-switch-focus`\);/g)).toBe(1);
        expect(count(/await startBenchmarkRecording\(page, `\$\{suite\}-edited`\);/g)).toBe(1);
        // The cold first take's one activation (mic-download) also starts it; it is the same press as the warm Start, never both.
        expect(count(/await preparePrivateModelIfPrompted\(page, 900_000\);/g)).toBe(1);
        expect(src).toMatch(/if \(!setup\.recordingAlreadyStarted\) \{\s*await waitForPrivateEngineReady\(page, 600_000\);\s*await startBenchmarkRecording\(page, suite\);/);
    });
    it('the three extra takes run only in the full (AHT-02) journey', () => {
        const fullOnly = src.indexOf("if (fixtureKey === 'focus_points_tts') {\n            // Both steps drive the current page");
        expect(fullOnly).toBeGreaterThan(0);
        for (const take of ['switch-openmic', 'switch-focus', 'edited']) expect(src.indexOf(`await startBenchmarkRecording(page, \`\${suite}-${take}\`);`)).toBeGreaterThan(fullOnly);
    });
    it('no Start-like control is clicked directly in this file (presses go through the cited helpers)', () => {
        for (const id of ['mic-start', 'mic-download', 'mic-retry', 'focus-points-retry', 'verdict-practice-again']) {
            expect(src).not.toContain(`getByTestId('${id}').click(`);
        }
    });
});
