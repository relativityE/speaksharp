import { describe, it, expect } from 'vitest';
import {
    calculateOverallStats,
    calculateFillerWordTrends
} from '../../frontend/src/lib/analyticsUtils';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { PracticeSession } from '../../frontend/src/types/session';

/**
 * SpeakSharp: Analytics Behavioral Integrity
 * 📊 Objective: Every metric a user sees must be provably correct.
 */

describe('Analytics Math Integrity', () => {

    describe('WER & Accuracy Score', () => {
        it('should correctly invert WER to Accuracy percentage (Requirement)', () => {
            const groundTruth = "This is a perfect sentence.";
            const transcript = "This is a perfect sentence.";
            const wer = calculateWordErrorRate(groundTruth, transcript);

            // Verification in user-meaningful terms
            const accuracy = Math.max(0, Math.round((1 - wer) * 100));
            expect(accuracy).toBe(100);
            expect(wer).toBe(0);
        });

        it('should handle 50% WER as 50% accuracy score', () => {
            const groundTruth = "one two three four";
            const transcript = "one two five six"; // 2/4 = 0.5 WER
            const wer = calculateWordErrorRate(groundTruth, transcript);
            const accuracy = Math.max(0, Math.round((1 - wer) * 100));
            expect(accuracy).toBe(50);
        });
    });

    describe('Words Per Minute (WPM)', () => {
        it('should match user-meaningful contract: WPM = count / minutes', () => {
            const session = {
                total_words: 150,
                duration: 60, // 1 minute
                created_at: new Date().toISOString(),
                filler_words: {}
            } as Partial<PracticeSession>;

            const stats = calculateOverallStats([session as PracticeSession]);
            expect(stats.averageWPM).toBe(150);
        });

        it('should accurately calculate WPM for fractional minutes', () => {
            const session = {
                total_words: 100,
                duration: 30, // 0.5 minutes
                created_at: new Date().toISOString(),
                filler_words: {}
            } as Partial<PracticeSession>;

            const stats = calculateOverallStats([session as PracticeSession]);
            expect(stats.averageWPM).toBe(200);
        });
    });

    describe('Filler Word Metrics', () => {
        it('should calculate Filler Words Per Minute (FWPM)', () => {
            const session = {
                total_words: 100,
                duration: 60,
                created_at: new Date().toISOString(),
                filler_words: {
                    um: { count: 5 },
                    total: { count: 5 }
                }
            } as Partial<PracticeSession>;

            const stats = calculateOverallStats([session as PracticeSession]);
            expect(stats.avgFillerWordsPerMin).toBe("5.0");
        });

        it('should correctly sum fillers across multiple sessions', () => {
            const sessions = [
                {
                    created_at: new Date().toISOString(),
                    filler_words: { um: { count: 5 }, total: { count: 5 } },
                    duration: 60,
                    total_words: 100
                },
                {
                    created_at: new Date().toISOString(),
                    filler_words: { like: { count: 2 }, total: { count: 2 } },
                    duration: 60,
                    total_words: 100
                }
            ] as Partial<PracticeSession>[];

            const stats = calculateOverallStats(sessions as PracticeSession[]);
            // (5 + 2) / (1 + 1) = 3.5 FWPM
            expect(stats.avgFillerWordsPerMin).toBe("3.5");
        });
    });

    describe('Improvement Trends (Rolling Windows)', () => {
        it('should track trends across 5-session rolling windows (Industry Standard)', () => {
            // We need 10 sessions to fill both current and previous windows
            const sessions = Array.from({ length: 10 }).map((_, i) => ({
                created_at: new Date(2023, 9, i + 1).toISOString(),
                filler_words: {
                    um: { count: i < 5 ? 5 : 10 }, // 10, 10, 10, 10, 10 (prev) vs 5, 5, 5, 5, 5 (curr)
                    total: { count: i < 5 ? 5 : 10 }
                }
            })) as Partial<PracticeSession>[];

            // Note: slice(0,5) is "current", slice(5,10) is "previous" based on implementation
            const trends = calculateFillerWordTrends(sessions as PracticeSession[]);

            // Current avg for 'um' (first 5 sessions in array) should be 5
            expect(trends.um.current).toBe(5);
            // Previous avg for 'um' (next 5 sessions in array) should be 10
            expect(trends.um.previous).toBe(10);
        });
    });
});
