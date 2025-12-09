import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionMetrics } from '../useSessionMetrics';

describe('useSessionMetrics', () => {
    describe('formattedTime', () => {
        it('formats 0 seconds as 00:00', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: '', fillerData: {}, elapsedTime: 0 })
            );
            expect(result.current.formattedTime).toBe('00:00');
        });

        it('formats 65 seconds as 01:05', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: '', fillerData: {}, elapsedTime: 65 })
            );
            expect(result.current.formattedTime).toBe('01:05');
        });

        it('formats 3661 seconds as 61:01', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: '', fillerData: {}, elapsedTime: 3661 })
            );
            expect(result.current.formattedTime).toBe('61:01');
        });
    });

    describe('wpm (words per minute)', () => {
        it('returns 0 when elapsed time is 0', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'hello world',
                    fillerData: {},
                    elapsedTime: 0
                })
            );
            expect(result.current.wpm).toBe(0);
        });

        it('calculates WPM correctly', () => {
            // 10 words in 30 seconds = (10/30) * 60 = 20 WPM
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'one two three four five six seven eight nine ten',
                    fillerData: {},
                    elapsedTime: 30
                })
            );
            expect(result.current.wpm).toBe(20);
        });

        it('returns optimal label for 120-160 WPM', () => {
            // 120 words in 60 seconds = 120 WPM
            const words = Array(120).fill('word').join(' ');
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: words, fillerData: {}, elapsedTime: 60 })
            );
            expect(result.current.wpmLabel).toBe('Optimal Range');
        });

        it('returns Too Fast for > 160 WPM', () => {
            // 200 words in 60 seconds = 200 WPM
            const words = Array(200).fill('word').join(' ');
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: words, fillerData: {}, elapsedTime: 60 })
            );
            expect(result.current.wpmLabel).toBe('Too Fast');
        });
    });

    describe('clarityScore', () => {
        it('returns 87 when no words or fillers', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: '', fillerData: {}, elapsedTime: 60 })
            );
            expect(result.current.clarityScore).toBe(87);
        });

        it('calculates clarity score correctly with fillers', () => {
            // 10 words, 2 fillers = 20% fillers = 80% clarity
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'one two three four five six seven eight nine ten',
                    fillerData: {
                        um: { count: 1, color: '#FCA5A5' },
                        uh: { count: 1, color: '#BFDBFE' }
                    },
                    elapsedTime: 60
                })
            );
            expect(result.current.clarityScore).toBe(80);
            expect(result.current.clarityLabel).toBe('Excellent clarity!');
        });

        it('returns Keep practicing for low clarity', () => {
            // 10 words, 5 fillers = 50% fillers = 50% clarity
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'one two three four five six seven eight nine ten',
                    fillerData: {
                        um: { count: 3, color: '#FCA5A5' },
                        uh: { count: 2, color: '#BFDBFE' }
                    },
                    elapsedTime: 60
                })
            );
            expect(result.current.clarityScore).toBe(50);
            expect(result.current.clarityLabel).toBe('Keep practicing');
        });
    });

    describe('fillerCount', () => {
        it('sums all filler word counts', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'test',
                    fillerData: {
                        um: { count: 3, color: '#FCA5A5' },
                        uh: { count: 2, color: '#BFDBFE' },
                        like: { count: 5, color: '#FDE68A' }
                    },
                    elapsedTime: 60
                })
            );
            expect(result.current.fillerCount).toBe(10);
        });
    });
});
