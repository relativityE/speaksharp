import { describe, expect, it } from 'vitest';
import {
    calculateCoreSessionMetrics,
    getWpmLabel,
    getSessionAnalysisMetrics,
} from '../sessionAnalysis';
import type { PracticeSession } from '@/types/session';

describe('sessionAnalysis metric truth', () => {
    it('counts captured filler words and explains their impact', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'Um I think uh this is like a useful test',
            durationSeconds: 30,
        });

        expect(metrics.wordCount).toBe(10);
        expect(metrics.fillerCount).toBe(3);
        expect(metrics.fillerData.total.count).toBe(3);
        expect(metrics.fillerExplanation).toContain('This is likely noticeable; pause before restarting a thought');
        expect(metrics.clarityExplanation).toContain('Replace the next one with a brief pause');
    });

    it('does not report perfect clarity for missing speech', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: '',
            durationSeconds: 60,
        });

        expect(metrics.clarityScore).toBe(0);
        expect(metrics.isClarityScorable).toBe(false);
        expect(metrics.clarityLabel).toBe('Not enough reliable speech to score');
        expect(metrics.clarityExplanation).toBe('No transcript was captured, so clarity cannot be scored yet.');
        expect(metrics.fillerExplanation).toBe('No transcript was captured, so filler words cannot be verified yet.');
    });

    it('does not score a one-word partial transcript as great clarity for a saved session', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'Well',
            durationSeconds: 15,
        });

        expect(metrics.wordCount).toBe(1);
        expect(metrics.isClarityScorable).toBe(false);
        expect(metrics.clarityLabel).toBe('Not enough reliable speech to score');
        expect(metrics.clarityExplanation).toMatch(/too little captured speech/i);
        expect(metrics.fillerExplanation).toMatch(/too little captured speech/i);
    });

    it('never reports low or missing WPM as optimal', () => {
        expect(getWpmLabel(0)).toBe('Not Measured');
        expect(getWpmLabel(20)).toBe('Too Slow');
        expect(getWpmLabel(129)).toBe('Too Slow');
        expect(getWpmLabel(140)).toBe('Optimal Range');
    });

    it('uses supplied live filler counts when they exceed final transcript text', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'This final transcript dropped the filler words',
            durationSeconds: 30,
            fillerData: {
                um: { count: 2 },
                total: { count: 2 },
            },
        });

        expect(metrics.fillerCount).toBe(2);
        expect(metrics.fillerData.total.count).toBe(2);
        expect(metrics.clarityScore).toBeLessThan(100);
    });

    it('uses one derivation path for persisted session metrics and repairs stale filler totals from transcript', () => {
        const session = {
            id: 'session-1',
            user_id: 'user-1',
            created_at: '2026-05-21T12:00:00.000Z',
            updated_at: '2026-05-21T12:00:00.000Z',
            title: 'Truth check',
            duration: 60,
            total_words: 8,
            transcript: 'um this transcript has uh two fillers',
            filler_words: { total: { count: 0 } },
            clarity_score: null,
            wpm: null,
        } as unknown as PracticeSession;

        const metrics = getSessionAnalysisMetrics(session);

        expect(metrics.fillerCount).toBe(2);
        expect(metrics.fillerData.total.count).toBe(2);
        expect(metrics.wpm).toBe(8);
        expect(metrics.clarityScore).toBeLessThan(100);
    });

    it('includes custom filler words when repairing persisted session metrics from transcript', () => {
        const session = {
            id: 'session-2',
            user_id: 'user-1',
            created_at: '2026-05-21T12:00:00.000Z',
            updated_at: '2026-05-21T12:00:00.000Z',
            title: 'Custom filler truth check',
            duration: 60,
            transcript: 'basically this basically needs to count',
            custom_words: { basically: { count: 0 } },
            filler_words: { total: { count: 0 } },
            clarity_score: null,
            wpm: null,
        } as unknown as PracticeSession;

        const metrics = getSessionAnalysisMetrics(session);

        expect(metrics.fillerData.basically.count).toBe(2);
        expect(metrics.fillerData.total.count).toBe(2);
        expect(metrics.fillerCount).toBe(2);
    });

    it('turns Cloud-quality transcript evidence into plain-language coaching', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'The stale smell of old beer, like, lingers, basically, a dash of pepper spoils beef stew. Well, the swan dive was far short of perfect.',
            durationSeconds: 26.194,
        });

        expect(metrics.wordCount).toBe(25);
        expect(metrics.fillerCount).toBe(2);
        expect(metrics.wpm).toBe(57);
        expect(metrics.wpmExplanation).toContain('very slow for most listeners');
        expect(metrics.fillerExplanation).toContain('Pick one repeat filler to replace with silence next time');
        expect(metrics.clarityExplanation).toContain('Replace the next one with a brief pause');
    });

    it('explains clean transcripts as a next-step coaching opportunity instead of a bare score', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'This answer is clear direct and easy for the audience to follow without filler words today',
            durationSeconds: 7,
        });

        expect(metrics.fillerCount).toBe(0);
        expect(metrics.fillerExplanation).toContain('Keep using silence as your reset');
        expect(metrics.clarityExplanation).toContain('Focus the next run on pacing and emphasis');
    });
});
