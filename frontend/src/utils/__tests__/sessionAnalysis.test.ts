import { describe, expect, it } from 'vitest';
import {
    calculateCoreSessionMetrics,
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
        expect(metrics.fillerExplanation).toContain('3 filler words detected');
        expect(metrics.clarityExplanation).toContain('3 filler words');
    });

    it('does not report perfect clarity for missing speech', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: '',
            durationSeconds: 60,
        });

        expect(metrics.clarityScore).toBe(0);
        expect(metrics.isClarityScorable).toBe(false);
        expect(metrics.clarityLabel).toBe('Not enough speech to score');
        expect(metrics.clarityExplanation).toBe('No transcript was captured, so clarity cannot be scored yet.');
        expect(metrics.fillerExplanation).toBe('No transcript was captured, so filler words cannot be verified yet.');
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
});
