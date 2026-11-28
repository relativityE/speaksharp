import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    answerFeel, answerPost, answerPre, clearConfidencePilot, startLoop, confidencePilotSnapshot, noteSessionPhase, noteTakeStart,
    pilotFor, revealReview, subscribeConfidencePilot,
} from '../pilotState';

const ME = 'user-1';
const mine = () => pilotFor(confidencePilotSnapshot(), ME);

/** One full explicitly started loop: pre, first take, Practice again, the repeat records, its after screen. */
function toRepeatAfter() {
    startLoop(ME);
    answerPre(ME, 2);
    noteTakeStart(ME, 'first');
    noteSessionPhase(ME, 'during');
    noteSessionPhase(ME, 'after');
    noteTakeStart(ME, 'repeat');
    noteSessionPhase(ME, 'after'); // the first take's after screen is still showing while the repeat starts
    expect(mine()?.askPost).toBe(false);
    noteSessionPhase(ME, 'during');
    noteSessionPhase(ME, 'after');
}

beforeEach(() => { clearConfidencePilot(); });

describe('confidence check pilot state (session-only)', () => {
    it('an explicitly started loop: pre kept through the first take; post asked only on the repeat\'s own after screen', () => {
        toRepeatAfter();
        expect(mine()).toMatchObject({ pre: 2, repeatPending: true, askPost: true, post: null, feel: null });
        answerPost(ME, 4);
        answerFeel(ME, 'easier');
        revealReview(ME);
        expect(mine()).toMatchObject({ pre: 2, post: 4, feel: 'easier', repeatPending: false, askPost: false });
    });

    it('the first take\'s after screen never asks the post questions', () => {
        startLoop(ME);
        answerPre(ME, 3);
        noteTakeStart(ME, 'first');
        noteSessionPhase(ME, 'during');
        noteSessionPhase(ME, 'after');
        expect(mine()).toMatchObject({ pre: 3, repeatPending: false, askPost: false });
        answerPost(ME, 5);
        expect(mine()?.post).toBeNull();
    });

    it('a loop begun later through Practice again gets no invented baseline', () => {
        noteTakeStart(ME, 'first');
        expect(mine()).toBeNull();
        noteTakeStart(ME, 'repeat');
        noteSessionPhase(ME, 'during');
        noteSessionPhase(ME, 'after');
        expect(mine()).toMatchObject({ pre: null, askPost: true });
    });

    it('a failed Start (still before, no audio) keeps the pre answer; a later plain take starts a new, empty loop', () => {
        startLoop(ME);
        answerPre(ME, 1);
        noteTakeStart(ME, 'first');
        noteTakeStart(ME, 'first');
        expect(mine()?.pre).toBe(1);
        noteSessionPhase(ME, 'during');
        noteSessionPhase(ME, 'after');
        noteTakeStart(ME, 'first');
        expect(mine()).toBeNull();
    });

    it('a rating alone never starts a loop: without "Start a practice loop" it is ignored', () => {
        answerPre(ME, 4);
        expect(mine()).toBeNull();
        startLoop(ME);
        expect(mine()).toMatchObject({ loopStarted: true, pre: null });
        noteTakeStart(ME, 'first');
        expect(mine()).toMatchObject({ loopStarted: true, pre: null });
    });

    it('answers stay bound to that exact repeat: the next repeat asks afresh and never shows the old answers', () => {
        toRepeatAfter();
        answerPost(ME, 4); answerFeel(ME, 'harder'); revealReview(ME);
        noteTakeStart(ME, 'repeat');
        expect(mine()).toMatchObject({ pre: 2, post: null, feel: null, askPost: false });
        noteSessionPhase(ME, 'during');
        noteSessionPhase(ME, 'after');
        expect(mine()).toMatchObject({ askPost: true, post: null, feel: null });
    });

    it('revealing without answering records skipped, never a low score; questions are not asked again', () => {
        toRepeatAfter();
        revealReview(ME);
        expect(mine()).toMatchObject({ post: 'skipped', feel: 'skipped', askPost: false });
        noteSessionPhase(ME, 'after');
        expect(mine()?.askPost).toBe(false);
    });

    it('another owner never sees or changes these answers', () => {
        toRepeatAfter();
        expect(pilotFor(confidencePilotSnapshot(), 'user-2')).toBeNull();
        answerPost('user-2', 1);
        revealReview('user-2');
        expect(mine()).toMatchObject({ askPost: true, post: null });
        expect(pilotFor(confidencePilotSnapshot(), null)).toBeNull();
    });

    it('notifies subscribers and clears', () => {
        let calls = 0;
        const off = subscribeConfidencePilot(() => { calls += 1; });
        startLoop(ME);
        clearConfidencePilot();
        off();
        startLoop(ME);
        expect(calls).toBe(2);
    });

    it('PRIVACY: the pilot code has no network, storage or telemetry path', () => {
        for (const file of ['../pilotState.ts', '../../../components/session/ConfidenceCheck.tsx', '../youSaidText.ts', '../../../config/confidenceCheckPilot.ts']) {
            // Code only: comments may describe what the pilot does NOT do.
            const source = readFileSync(resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
            expect({ file, hit: source.match(/posthog|emit[A-Z]\w*\(|capture\(|fetch\(|supabase|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon|telemetry/i)?.[0] ?? null }).toEqual({ file, hit: null });
        }
    });
});
