import { describe, it, expect } from 'vitest';
import { calculateTrends } from '../components/AnalyticsDashboard';

describe('AnalyticsDashboard - calculateTrends', () => {
  it('should correctly process sessions with the new filler_words schema', () => {
    const mockHistory = [
      {
        id: '1',
        created_at: new Date().toISOString(),
        duration: 120, // 2 minutes
        filler_words: {
          'um': { count: 5, color: '#f00' },
          'like': { count: 3, color: '#0f0' },
        },
      },
      {
        id: '2',
        created_at: new Date().toISOString(),
        duration: 60, // 1 minute
        filler_words: {
          'um': { count: 2, color: '#f00' },
          'so': { count: 4, color: '#00f' },
        },
      },
    ];

    const trends = calculateTrends(mockHistory);

    // Test top filler words calculation
    expect(trends.topFillerWords).toHaveLength(3);
    expect(trends.topFillerWords[0]).toEqual({ name: 'um', value: 7 });
    expect(trends.topFillerWords[1]).toEqual({ name: 'so', value: 4 });
    expect(trends.topFillerWords[2]).toEqual({ name: 'like', value: 3 });

    // Test chart data calculation
    expect(trends.chartData).toHaveLength(2);
    expect(trends.chartData[0]).toHaveProperty('date');
    expect(trends.chartData[0]['FW/min']).toBe('6.0'); // (2+4) / 1 min

    // Test aggregate stats
    expect(trends.totalSessions).toBe(2);
    expect(trends.totalPracticeTime).toBe(3); // 180 seconds = 3 mins
    expect(trends.avgFillerWordsPerMin).toBe('4.7'); // (5+3+2+4) / 3 mins = 14 / 3 = 4.666 -> '4.7'
  });

  it('should handle sessions with old filler_counts schema', () => {
    const mockHistory = [
      {
        id: '1',
        created_at: new Date().toISOString(),
        duration: 60,
        filler_counts: {
          'um': 10,
        },
      },
    ];
    const trends = calculateTrends(mockHistory);
    expect(trends.topFillerWords).toEqual([{ name: 'um', value: 10 }]);
  });

  it('should handle empty history', () => {
    const trends = calculateTrends([]);
    expect(trends.totalSessions).toBe(0);
    expect(trends.topFillerWords).toEqual([]);
    expect(trends.chartData).toEqual([]);
  });

  it('should handle sessions with no filler words', () => {
    const mockHistory = [
      {
        id: '1',
        created_at: new Date().toISOString(),
        duration: 60,
        filler_words: {},
      },
    ];
    const trends = calculateTrends(mockHistory);
    expect(trends.totalSessions).toBe(1);
    expect(trends.topFillerWords).toEqual([]);
    expect(trends.avgFillerWordsPerMin).toBe('0.0');
  });

  it('should handle sessions with null or invalid duration', () => {
    const mockHistory = [
      {
        id: '1',
        created_at: new Date().toISOString(),
        duration: 120, // 2 minutes
        filler_words: { 'um': { count: 10 } },
      },
      {
        id: '2',
        created_at: new Date().toISOString(),
        duration: null, // Invalid duration
        filler_words: { 'like': { count: 5 } },
      },
       {
        id: '3',
        created_at: new Date().toISOString(),
        duration: ' sixty ', // Invalid duration
        filler_words: { 'so': { count: 5 } },
      },
    ];

    const trends = calculateTrends(mockHistory);

    expect(trends.totalSessions).toBe(3);
    expect(trends.totalPracticeTime).toBe(2); // Only the first session is valid
    expect(trends.avgFillerWordsPerMin).not.toBe('NaN');
    expect(trends.avgFillerWordsPerMin).toBe('5.0'); // 10 fillers / 2 mins = 5.0
  });
});
