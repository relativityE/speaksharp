import { describe, it, expect } from 'vitest';
import { calculateTrends } from '../analyticsUtils';

describe('calculateTrends', () => {
  it('should return zeroed-out data for empty or null history', () => {
    expect(calculateTrends(null)).toEqual({
      avgFillerWordsPerMin: '0.0',
      totalSessions: 0,
      totalPracticeTime: 0,
      avgAccuracy: '0.0',
      chartData: [],
      topFillerWords: [],
    });

    expect(calculateTrends([])).toEqual({
      avgFillerWordsPerMin: '0.0',
      totalSessions: 0,
      totalPracticeTime: 0,
      avgAccuracy: '0.0',
      chartData: [],
      topFillerWords: [],
    });
  });

  it('should correctly calculate trends for a single valid session', () => {
    const history = [
      {
        created_at: '2025-01-15T10:00:00Z',
        duration: 120, // 2 minutes
        total_words: 200,
        filler_words: { um: { count: 5 }, ah: { count: 2 } },
        accuracy: 0.95,
      },
    ];

    const result = calculateTrends(history);

    expect(result.totalSessions).toBe(1);
    expect(result.totalPracticeTime).toBe(2); // 2 minutes
    expect(result.avgFillerWordsPerMin).toBe('3.5'); // 7 fillers / 2 mins
    expect(result.avgAccuracy).toBe('95.0');
    expect(result.chartData.length).toBe(1);
    expect(result.topFillerWords).toEqual([
        { name: 'um', value: 5 },
        { name: 'ah', value: 2 },
    ]);
  });

  it('should handle sessions with missing or zero values gracefully', () => {
    const history = [
      {
        created_at: '2025-01-15T10:00:00Z',
        duration: 0, // zero duration
        total_words: 100,
        filler_words: null, // no filler words
        accuracy: null, // no accuracy
      },
    ];

    const result = calculateTrends(history);

    expect(result.totalSessions).toBe(1);
    expect(result.totalPracticeTime).toBe(0);
    expect(result.avgFillerWordsPerMin).toBe('0.0');
    expect(result.avgAccuracy).toBe('0.0');
    expect(result.chartData.length).toBe(1);
    expect(result.chartData[0]['FW/min']).toBe('0.0');
    expect(result.topFillerWords).toEqual([]);
  });

  it('should correctly aggregate data from multiple sessions', () => {
    const history = [
      {
        created_at: '2025-01-15T11:00:00Z',
        duration: 180, // 3 minutes
        total_words: 300,
        filler_words: { um: { count: 6 }, like: { count: 4 } },
        accuracy: 0.98,
      },
      {
        created_at: '2025-01-14T09:00:00Z',
        duration: 120, // 2 minutes
        total_words: 220,
        filler_words: { um: { count: 2 }, so: { count: 3 } },
        accuracy: 0.92,
      },
    ];

    const result = calculateTrends(history);

    expect(result.totalSessions).toBe(2);
    expect(result.totalPracticeTime).toBe(5); // 3 + 2 minutes
    expect(result.avgFillerWordsPerMin).toBe('3.0'); // (10+5) / 5 mins = 15 / 5 = 3
    expect(result.avgAccuracy).toBe('95.0'); // (98 + 92) / 2
    expect(result.chartData.length).toBe(2);
    expect(result.topFillerWords).toEqual([
        { name: 'um', value: 8 },
        { name: 'like', value: 4 },
        { name: 'so', value: 3 },
    ]);
  });
});
