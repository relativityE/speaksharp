import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Mock data for demonstration purposes
const mockFreeTierData = {
  sessionHistory: [
    { id: 1, date: 'Yesterday', totalWords: 5, wordsPerMin: 2.5 },
    { id: 2, date: '2 days ago', totalWords: 8, wordsPerMin: 4.0 },
    { id: 3, date: '3 days ago', totalWords: 4, wordsPerMin: 2.0 },
  ],
  trends: {
    last7Days: 5.6, // Average filler words
  }
};

const mockProTierData = {
  sessionHistory: [
    ...mockFreeTierData.sessionHistory,
    { id: 4, date: '4 days ago', totalWords: 10, wordsPerMin: 5.0 },
    { id: 5, date: '5 days ago', totalWords: 12, wordsPerMin: 6.0 },
    { id: 6, date: '6 days ago', totalWords: 7, wordsPerMin: 3.5 },
  ],
  trends: {
    last7Days: 7.3,
    last30Days: 8.1,
    allTime: 9.2,
  },
  // Pro features would have more detailed data, like charts
};

export const AnalyticsDashboard = ({ tier = 'free' }) => {
  const data = tier === 'pro' ? mockProTierData : mockFreeTierData;

  return (
    <div className="space-y-6 mt-8">
      <Card>
        <CardHeader>
          <CardTitle>Your Analytics Dashboard</CardTitle>
          <CardDescription>
            {tier === 'free'
              ? 'Showing data for your last 3 sessions. Upgrade to Pro for unlimited history and trends.'
              : 'Showing your full session history and progress trends.'
            }
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Key Stats Section */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Avg. Filler Words (Last 7 Days)</CardTitle></CardHeader>
          <CardContent><div className="text-4xl font-bold">{data.trends.last7Days}</div></CardContent>
        </Card>
        <Card className={tier === 'free' ? 'opacity-50' : ''}>
          <CardHeader><CardTitle>Avg. Filler Words (Last 30 Days)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{data.trends.last30Days || 'N/A'}</div>
            {tier === 'free' && <span className="text-xs text-muted-foreground">Pro Feature</span>}
          </CardContent>
        </Card>
        <Card className={tier === 'free' ? 'opacity-50' : ''}>
          <CardHeader><CardTitle>Avg. Filler Words (All Time)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{data.trends.allTime || 'N/A'}</div>
            {tier === 'free' && <span className="text-xs text-muted-foreground">Pro Feature</span>}
          </CardContent>
        </Card>
      </div>

      {/* Session History Section */}
      <Card>
        <CardHeader>
          <CardTitle>Session History</CardTitle>
        </CardHeader>
        <CardContent>
          <ul>
            {data.sessionHistory.map(session => (
              <li key={session.id} className="flex justify-between items-center p-2 border-b">
                <span>{session.date}</span>
                <span>{session.totalWords} filler words</span>
                <span>{session.wordsPerMin} words/min</span>
              </li>
            ))}
          </ul>
          {tier === 'free' && (
            <div className="text-center mt-4">
              <Button>Upgrade to Pro to see all history</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
