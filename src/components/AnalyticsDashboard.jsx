import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export const AnalyticsDashboard = ({ transcript, fillerCounts, duration }) => {
  if (!fillerCounts) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <p>No session data available. Complete a session to see your results.</p>
        </CardContent>
      </Card>
    );
  }

  const totalFillerWords = Object.values(fillerCounts).reduce((sum, count) => sum + count, 0);
  const durationInMinutes = duration > 0 ? duration / 1000 / 60 : 0;
  const wordsPerMin = durationInMinutes > 0 ? (totalFillerWords / durationInMinutes).toFixed(1) : 0;

  const sortedFillerWords = Object.entries(fillerCounts).sort((a, b) => b[1] - a[1]);
  const mostCommonFiller = sortedFillerWords.length > 0 ? sortedFillerWords[0] : null;

  return (
    <div className="space-y-6 mt-8">
      <Card>
        <CardHeader>
          <CardTitle>Session Report</CardTitle>
          <CardDescription>
            Here's a summary of your last recording session.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Total Filler Words</CardTitle></CardHeader>
          <CardContent><div className="text-4xl font-bold">{totalFillerWords}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Filler Words/Min</CardTitle></CardHeader>
          <CardContent><div className="text-4xl font-bold">{wordsPerMin}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Most Common</CardTitle></CardHeader>
          <CardContent>
            <div className="text-4xl font-bold capitalize">{mostCommonFiller ? mostCommonFiller[0] : 'N/A'}</div>
            <p className="text-sm text-muted-foreground">{mostCommonFiller ? `${mostCommonFiller[1]} times` : ''}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-left p-4 border rounded-lg bg-gray-50">{transcript || 'No transcript available.'}</p>
        </CardContent>
      </Card>
    </div>
  );
};
