import { useState } from 'react';

// This is a mock data generator. In a real application, this data would be fetched
// from a backend API and managed with a library like React Query.
const generateMockData = () => {
  return {
    // Data for a summary chart showing filler words per session over time
    sessionTrends: [
      { name: 'Session 1', fillerWords: 15, duration: 300 },
      { name: 'Session 2', fillerWords: 12, duration: 450 },
      { name: 'Session 3', fillerWords: 14, duration: 320 },
      { name: 'Session 4', fillerWords: 8, duration: 500 },
      { name: 'Session 5', fillerWords: 5, duration: 480 },
      { name: 'Session 6', fillerWords: 7, duration: 600 },
    ],
    // Data for a pie chart showing the distribution of filler words
    fillerWordDistribution: [
      { name: 'um', value: 45 },
      { name: 'uh', value: 38 },
      { name: 'like', value: 25 },
      { name: 'so', value: 18 },
      { name: 'you know', value: 12 },
      { name: 'actually', value: 9 },
    ],
    // Key stats for display
    keyStats: {
      totalSessions: 6,
      averageFillerWordsPerMinute: 1.8,
      mostCommonFillerWord: 'um',
      speakingPace: 145, // words per minute
    },
    // Mock session history
    sessionHistory: [
      {
        id: 1,
        title: 'Practice for team meeting',
        date: '2025-08-07',
        duration: '5:00',
        totalFillerWords: 15,
        transcript: 'So, um, the first point I want to make is, uh, about the Q3 results. Like, they were pretty good...'
      },
      {
        id: 2,
        title: 'Toastmasters Speech Prep',
        date: '2025-08-05',
        duration: '7:30',
        totalFillerWords: 12,
        transcript: 'Good evening everyone. You know, I was thinking about, uh, the nature of courage...'
      },
      {
        id: 3,
        title: 'Project Update Presentation',
        date: '2025-08-02',
        duration: '5:20',
        totalFillerWords: 14,
        transcript: 'Actually, the project is, um, going very well. We have, like, completed the first phase...'
      }
    ]
  };
};

/**
 * A mock hook to provide static data for the analytics dashboard.
 * In a real application, this would fetch data from an API.
 * @returns {{ data: object, isLoading: boolean, error: object|null }}
 */
export const useAnalyticsData = () => {
  const [data] = useState(generateMockData());
  const [isLoading] = useState(false);
  const [error] = useState(null);

  // We return a shape similar to what a data fetching library like React Query would provide.
  return { data, isLoading, error };
};
