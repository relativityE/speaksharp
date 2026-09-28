// @vitest-environment node
/**
 * #1532 (PM RETURN 5864985070) — THE PARTIAL FIXTURE MUST PRODUCE `partial` UNDER THE REAL MATCHER.
 *
 * The paid `rwt-focus-points-partial` rehearsal asserts `covered, covered, partial, missing` (3/4 detected). Its
 * previous point-3 sentence ("try it with a single group") shared none of the point's keywords, so the real matcher
 * scored it `missing` even from a perfect transcript: that rehearsal could only ever FAIL. This guard runs the text the
 * generator actually speaks, and the offline whisper-base.en transcript of the committed WAV, through the product's
 * own `deriveFocusCoverage`, so a script or matcher change that breaks the fixture fails here, not in Production.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveFocusCoverage } from '../../frontend/src/utils/focusCoverage';
import { detectedCountExpected } from '../live/helpers/rwtOracles';

const FIXTURES = resolve(__dirname, '../fixtures/rwt');
const manifest = JSON.parse(readFileSync(resolve(FIXTURES, 'rwt-fixtures.manifest.json'), 'utf8'));
const findEntry = (o: unknown): Record<string, unknown> | null => {
    if (!o || typeof o !== 'object') return null;
    const rec = o as Record<string, unknown>;
    if (rec.focus_points_partial_tts && typeof rec.focus_points_partial_tts === 'object') return rec.focus_points_partial_tts as Record<string, unknown>;
    for (const v of Object.values(rec)) { const r = findEntry(v); if (r) return r; }
    return null;
};
const entry = findEntry(manifest)!;
const points = entry.points as string[];
const expectedFinal = entry.expectedFinal as string[];
const spoken = /^FOCUS_POINTS_PARTIAL="([^"]+)"$/m.exec(readFileSync(resolve(FIXTURES, 'generate-rwt-tts-fixtures.sh'), 'utf8'))?.[1] ?? '';
/** whisper-base.en (transformers.js 2.17.2, offline, self-hosted model) on the committed WAV, 2026-09-28. */
const WHISPER_TRANSCRIPT = 'Here is our plan for a better weekly handoff. First, updates get lost across scattered tools. People cannot tell which changes matter. Second, a shared board assigns an owner and deadline to every task. So teammates know who to contact for help. After that we will pilot the board with one team before anyone else uses it. Thanks for listening.';

describe('#1532 partial fixture under the real matcher', () => {
    it('the manifest expects exactly covered, covered, partial, missing (3/4 detected)', () => {
        expect(expectedFinal).toEqual(['covered', 'covered', 'partial', 'missing']);
        expect(detectedCountExpected(expectedFinal)).toBe(3);
    });
    it('the generator\'s spoken text scores exactly the expected verdicts', () => {
        expect(spoken).not.toBe('');
        expect(deriveFocusCoverage(points, spoken, entry.speechSeconds as number).rows.map((r) => r.status)).toEqual(expectedFinal);
    });
    it('the offline STT transcript of the committed WAV scores exactly the expected verdicts', () => {
        expect(deriveFocusCoverage(points, WHISPER_TRANSCRIPT, entry.speechSeconds as number).rows.map((r) => r.status)).toEqual(expectedFinal);
    });
});
