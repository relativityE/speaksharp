// @vitest-environment node
/**
 * PO 2026-10-07 — "print the suggestions in the github run results": synthetic-voice takes only, rendered safely,
 * written outside the content-free receipt and never added to the uploaded artifact.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain ESM script without type declarations
import { cell, renderCoachingText } from '../../scripts/rwt-coaching-text-summary.mjs';
import { RwtReceipt, writeCoachingTextForRunSummary } from '../live/helpers/rwtJourney';

const PAIR = { shownWell: 'Clear plan in three steps.', shownNext: 'Pause before each step.', savedWell: 'Clear plan in three steps.', savedNext: 'Pause before each step.' };

describe('coaching text in the run summary (synthetic takes only)', () => {
    it('renders the shown and saved pairs and whether they match', () => {
        const md = renderCoachingText([{ suite: 'open-mic-first-session', fixture: 'open_mic_tts', fixtureKind: 'synthetic', ...PAIR, shownMatchesSaved: true }]);
        expect(md).toContain('| Shown on the page | Clear plan in three steps. | Pause before each step. |');
        expect(md).toContain('Shown matches saved: **yes**');
    });

    it('CASUALTY: a human-voice record is never rendered, even if a file exists', () => {
        expect(renderCoachingText([{ suite: 's', fixture: 'open_mic_human', fixtureKind: 'human', ...PAIR, shownMatchesSaved: true }])).toBe('');
        expect(renderCoachingText([null, { fixtureKind: undefined, ...PAIR }])).toBe('');
    });

    it('cells cannot break the table or inject HTML; empty reads as an explicit absence', () => {
        expect(cell('a | b\nc <script>')).toBe('a \\| b c &lt;script&gt;');
        expect(cell('')).toBe('_(none)_');
        expect(cell(undefined)).toBe('_(none)_');
    });

    it('the writer writes for a synthetic fixture and refuses a human one', () => {
        const cwd = process.cwd();
        const dir = mkdtempSync(path.join(tmpdir(), 'cts-'));
        process.chdir(dir);
        try {
            const human = new RwtReceipt('human-suite');
            human.meta.fixtureKind = 'human';
            expect(writeCoachingTextForRunSummary(human, PAIR)).toBe(false);
            expect(existsSync(path.join(dir, 'test-results', 'rwt', 'human-suite.coaching-text.json'))).toBe(false);
            const synth = new RwtReceipt('synth-suite');
            synth.meta.fixtureKind = 'synthetic';
            synth.meta.fixture = 'open_mic_tts';
            expect(writeCoachingTextForRunSummary(synth, { ...PAIR, savedNext: '' })).toBe(true);
            const record = JSON.parse(readFileSync(path.join(dir, 'test-results', 'rwt', 'synth-suite.coaching-text.json'), 'utf8'));
            expect(record).toMatchObject({ suite: 'synth-suite', fixtureKind: 'synthetic', fixture: 'open_mic_tts', shownMatchesSaved: false });
        } finally {
            process.chdir(cwd);
        }
    });

    it('the uploaded receipt artifact never includes the coaching-text files', () => {
        const wf = readFileSync(path.resolve(__dirname, '../../.github/workflows/rc-gates.yml'), 'utf8');
        const upload = wf.slice(wf.indexOf('- name: Upload RWT receipts (content-free)'));
        const paths = upload.slice(upload.indexOf('path: |'), upload.indexOf('retention-days'));
        expect(paths).not.toMatch(/coaching-text|test-results\/rwt\/\*\s*$/m);
        expect(wf).toContain('node scripts/rwt-coaching-text-summary.mjs "${files[@]}" >> "$GITHUB_STEP_SUMMARY"');
    });
});
