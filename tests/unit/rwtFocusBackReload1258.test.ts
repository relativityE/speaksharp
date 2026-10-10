// @vitest-environment node
/**
 * #1258 (Browser PM 6093772463) — Focus Points: Progress → browser Back → the SAME saved session → reload, on the deployed
 * engine, reusing the existing first take. Same session id, the same saved transcript and verdicts, the saved review shown,
 * no idle or live recorder, and no regenerated coaching. Required for both Focus suites.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { focusBackReloadVerdict, type FocusBackReloadObservation } from '../live/helpers/rwtOracles';
import { requiredAutomatedRows } from '../live/helpers/rwtAcceptance';

const ok: FocusBackReloadObservation = {
    leftForProgress: true, restoredAfterBack: true, liveMicTracksAfterBack: 0, restoredAfterReload: true, sameSessionAfterReload: true,
    idleRecorderShown: false, liveMicTracks: 0, transcriptMatchesSaved: true, reviewAfterBack: 'saved', reviewAfterReload: 'saved', coachingSaved: true,
    verdictsBefore: ['p1:detected', 'p2:not_detected'], verdictsAfter: ['p1:detected', 'p2:not_detected'], coachingRequestsBefore: 1, coachingRequestsAfter: 1,
};
const v = (o: Partial<FocusBackReloadObservation>) => focusBackReloadVerdict({ ...ok, ...o }).verdict;

describe('Focus Back from Progress, then reload', () => {
    it('PASS: restored after Back and after reload, same session, transcript and verdicts, review shown, nothing regenerated', () => {
        expect(v({})).toBe('PASS');
    });
    // Browser PM RETURN on c76283d12: the rehearsal take is the newest, with its transcript and Focus results kept, so with no
    // saved coaching the ONLY correct view is Try again — after Back AND after the reload. `not_available` is never a waiver.
    it('no saved coaching: Try again after Back and after reload passes; not_available or missing after either FAILS', () => {
        const none = { coachingSaved: false };
        expect([
            v({ ...none, reviewAfterBack: 'try_again', reviewAfterReload: 'try_again' }),
            v({ ...none, reviewAfterBack: 'not_available', reviewAfterReload: 'try_again' }),
            v({ ...none, reviewAfterBack: 'try_again', reviewAfterReload: 'not_available' }),
            v({ ...none, reviewAfterBack: 'try_again', reviewAfterReload: 'missing' }),
        ]).toEqual(['PASS', 'FAIL', 'FAIL', 'FAIL']);
    });
    it('CASUALTY (run 37706942773 / D1): idle recorder, lost session, reload losing it, or a live mic each FAIL', () => {
        expect([
            v({ restoredAfterBack: false }), v({ idleRecorderShown: true }), v({ restoredAfterReload: false }),
            v({ sameSessionAfterReload: false }), v({ liveMicTracks: 1 }), v({ leftForProgress: false }),
            v({ liveMicTracksAfterBack: 1 }), v({ liveMicTracksAfterBack: null }),
        ]).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
    });
    it('CASUALTY: a different transcript, changed verdicts, no readable verdicts, regenerated coaching or a missing review FAIL', () => {
        expect([
            v({ transcriptMatchesSaved: false }), v({ verdictsAfter: ['p1:not_detected', 'p2:detected'] }), v({ verdictsBefore: [], verdictsAfter: [] }),
            v({ coachingRequestsAfter: 2 }), v({ reviewAfterBack: 'missing' }), v({ reviewAfterBack: 'try_again' }),
            v({ reviewAfterReload: 'missing' }), v({ reviewAfterReload: 'try_again' }),
        ]).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
    });
    it('both Focus suites require the row; the step reuses the existing take and its reads fail closed', () => {
        for (const suite of ['focus-points-session', 'focus-points-partial']) {
            expect(requiredAutomatedRows(suite)?.product).toEqual(expect.arrayContaining(['Focus Back from Progress and reload keep the saved session']));
        }
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        const step = helper.slice(helper.indexOf("'Focus Points: Progress, Back to the saved session, then reload'"), helper.lastIndexOf("receipt.row('Focus Back from Progress and reload keep the saved session'"));
        expect(step).toMatch(/backFromProgressRestoresSession\(page, persistedId, savedCoaching \?\? undefined\)/);
        expect(step).not.toMatch(/startBenchmarkRecording/);
        expect(step).toMatch(/reviewAfterReload: reload\.review/);
        const journey = readFileSync(resolve(__dirname, '../live/helpers/rwtJourney.ts'), 'utf8');
        const reloadHelper = journey.slice(journey.indexOf('export async function reloadRestoredSession'), journey.indexOf('export function backFromProgressRows'));
        expect(reloadHelper).toMatch(/readRestoredReview\(page, savedCoaching\)/);
        const reads = step.match(/admin!\.from\(/g)?.length ?? 0;
        expect([reads > 0, step.match(/\(fail closed\)/g)?.length ?? 0]).toEqual([true, reads]);
    });
});
