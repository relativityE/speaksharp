import { describe, it, expect, vi } from 'vitest';
import { calculateOverallStats, calculateFillerWordTrends } from '../analyticsUtils';
import { FILLER_WORD_KEYS } from '../../config';
import type { PracticeSession } from '../../types/session';

// Mock the config to ensure tests are stable regardless of config changes
vi.mock('../../config', () => ({
  FILLER_WORD_KEYS: {
    "actually": "actually",
    "basically": "basically",
    "like": "like",
    "so": "so",
    "um": "um",
    "uh": "uh",
    "you know": "you know",
  }
}));

const mockSessions: PracticeSession[] = [
  // Most recent session
  {
    id: 'session-4',
    user_id: 'user-1',
    created_at: '2023-10-04T10:00:00Z',
    duration: 300, // 5 minutes
    transcript: 'This is a test transcript okay so like yeah',
    total_words: 100,
    filler_words: {
      'so': { count: 1 },
      'like': { count: 1 },
    },
    accuracy: 0.95,
  },
  // Second most recent
  {
    id: 'session-3',
    user_id: 'user-1',
    created_at: '2023-10-03T10:00:00Z',
    duration: 120, // 2 minutes
    transcript: 'This is another test you know',
    total_words: 50,
    filler_words: {
      'you know': { count: 5 },
      'so': { count: 3 },
    },
    accuracy: 0.90,
  },
  // Third session (no accuracy)
  {
    id: 'session-2',
    user_id: 'user-1',
    created_at: '2023-10-02T10:00:00Z',
    duration: 60, // 1 minute
    transcript: 'A short one um',
    total_words: 30,
    filler_words: {
      'um': { count: 8 },
      'so': { count: 0 },
    },
  },
  // Oldest session
  {
    id: 'session-1',
    user_id: 'user-1',
    created_at: '2023-10-01T10:00:00Z',
    duration: 20, // < 30 seconds, should not contribute to per-minute calculation if logic is strict
    transcript: 'Basically a very short one',
    total_words: 10,
    filler_words: {
      'basically': { count: 1 },
    },
    accuracy: 0.88,
  },
];

describe('analyticsUtils', () => {

  describe('calculateOverallStats', () => {
    it('should return default zeroed stats for empty history', () => {
      const stats = calculateOverallStats([]);
      expect(stats.totalSessions).toBe(0);
      expect(stats.totalPracticeTime).toBe("0.0");
      expect(stats.avgFillerWordsPerMin).toBe("0.0");
      expect(stats.avgAccuracy).toBe("0.0");
      expect(stats.avgWpm).toBe("0");
      expect(stats.chartData).toEqual([]);
      expect(stats.topFillerWords).toEqual([]);
    });

    it('should return default zeroed stats for null history', () => {
      // @ts-expect-error - Testing invalid input
      const stats = calculateOverallStats(null);
      expect(stats.totalSessions).toBe(0);
    });

    it('should calculate aggregate statistics correctly', () => {
      const stats = calculateOverallStats(mockSessions);

      const totalDurationSeconds = 300 + 120 + 60 + 20; // 500
      const totalDurationMinutes = totalDurationSeconds / 60; // 8.333...

      const totalFillerWords = 1 + 1 + 5 + 3 + 8 + 1; // 19
      const totalWords = (mockSessions[0].total_words || 0) + (mockSessions[1].total_words || 0) + (mockSessions[2].total_words || 0) + (mockSessions[3].total_words || 0);

      // Avg Filler Words Per Min = 19 / 8.333... = 2.28
      const expectedFwPerMin = (totalFillerWords / totalDurationMinutes).toFixed(1);

      // Avg Accuracy = (0.95 + 0.90 + 0.88) / 3 = 0.91 * 100 = 91.0
      const expectedAvgAccuracy = (((0.95 + 0.90 + 0.88) / 3) * 100).toFixed(1);

      const expectedAvgWpm = (totalWords / totalDurationMinutes).toFixed(0);

      expect(stats.totalSessions).toBe(4);
      expect(stats.totalPracticeTime).toBe(totalDurationMinutes.toFixed(1)); // "8.3"
      expect(stats.avgFillerWordsPerMin).toBe(expectedFwPerMin); // "2.3"
      expect(stats.avgAccuracy).toBe(expectedAvgAccuracy); // "91.0"
      expect(stats.avgWpm).toBe(expectedAvgWpm);
    });

    it('should generate correct chart data (reversed chronological)', () => {
      const stats = calculateOverallStats(mockSessions);
      expect(stats.chartData).toHaveLength(4);
      // Chart data is reversed, so session 1 is first
      expect(stats.chartData[0].date).toBe('October 1, 2023');
      expect(stats.chartData[0]['FW/min']).toBe('3.0'); // 1 filler / (20/60) mins
      expect(stats.chartData[3].date).toBe('October 4, 2023');
      expect(stats.chartData[3]['FW/min']).toBe('0.4'); // 2 fillers / 5 mins
    });

    it('should calculate top 5 filler words correctly', () => {
      const stats = calculateOverallStats(mockSessions);
      const expectedTopWords = [
        { name: 'um', value: 8 },
        { name: 'you know', value: 5 },
        { name: 'so', value: 4 },
        { name: 'like', value: 1 },
        { name: 'basically', value: 1 },
      ];
      expect(stats.topFillerWords).toEqual(expectedTopWords);
    });

    it('should handle sessions with no filler words or duration', () => {
       const incompleteSessions: PracticeSession[] = [
        { id: '1', created_at: '2023-01-01T00:00:00Z', user_id: '1', duration: 60, filler_words: {} },
        // @ts-expect-error - Testing invalid input
        { id: '2', created_at: '2023-01-02T00:00:00Z', user_id: '1', filler_words: { so: { count: 1 } } },
       ];
       const stats = calculateOverallStats(incompleteSessions);
       expect(stats.totalSessions).toBe(2);
       expect(stats.avgFillerWordsPerMin).toBe('0.0');
    });
  });

  describe('calculateFillerWordTrends', () => {
    it('should return an empty object for empty sessions', () => {
      const trends = calculateFillerWordTrends([]);
      expect(trends).toEqual({});
    });

    it('should calculate trends for all filler words', () => {
      const trends = calculateFillerWordTrends(mockSessions);
      expect(Object.keys(trends)).toEqual(Object.values(FILLER_WORD_KEYS));
    });

    it('should calculate trend data for a specific word ("so")', () => {
      const trends = calculateFillerWordTrends(mockSessions);
      const soTrend = trends['so'];

      expect(soTrend).toHaveLength(4);

      // Session 4 (most recent)
      expect(soTrend[0].count).toBe(1);
      expect(soTrend[0].severity).toBe('green');
      expect(soTrend[0].tooltip).toContain('67% decrease'); // 3 -> 1

      // Session 3
      expect(soTrend[1].count).toBe(3);
      expect(soTrend[1].severity).toBe('green');
      expect(soTrend[1].tooltip).toContain('increase from last session'); // 0 -> 3

      // Session 2
      expect(soTrend[2].count).toBe(0);
      expect(soTrend[2].severity).toBe('green');
      expect(soTrend[2].tooltip).toContain('No change'); // No 'so' in session 1, so prev is 0.

      // Session 1 (oldest)
      expect(soTrend[3].count).toBe(0);
      expect(soTrend[3].tooltip).toBe('Count: 0'); // No previous session
    });

    it('should handle a word that appears for the first time', () => {
        const trends = calculateFillerWordTrends(mockSessions);
        const umTrend = trends['um'];

        // Session 2 is where 'um' first appears
        expect(umTrend[2].count).toBe(8);
        expect(umTrend[2].severity).toBe('orange');
        expect(umTrend[2].tooltip).toContain('increase from last session'); // 0 -> 8
    });

    it('should handle severity levels correctly', () => {
        const trends = calculateFillerWordTrends(mockSessions);
        // 1 count -> green
        expect(trends.like[0].severity).toBe('green');
        // 5 count -> yellow
        expect(trends['you know'][1].severity).toBe('yellow');
        // 8 count -> orange
        expect(trends.um[2].severity).toBe('orange');

        const redSession: PracticeSession[] = [{
            id: '5',
            user_id: '1',
            created_at: '2023-10-05T10:00:00Z',
            duration: 60,
            filler_words: { um: { count: 12 } }
        }];
        const redTrends = calculateFillerWordTrends(redSession);
        expect(redTrends.um[0].severity).toBe('red');
    });
  });
});
