import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF1919', '#4CAF50', '#FFC107', '#9C27B0'];

// A helper function to calculate stats from the current session data
const calculateSessionStats = (fillerCounts, sessionDuration, transcript) => {
  const totalFillerWords = Object.values(fillerCounts).reduce((sum, count) => sum + count, 0);
  const minutes = sessionDuration / 60;
  const fillerWordsPerMinute = minutes > 0 ? (totalFillerWords / minutes).toFixed(1) : 0;

  const wordCount = transcript.split(/\s+/).filter(Boolean).length;
  const speakingPace = minutes > 0 ? Math.round(wordCount / minutes) : 0;

  let mostCommonFillerWord = 'N/A';
  let maxCount = 0;
  for (const word in fillerCounts) {
    if (fillerCounts[word] > maxCount) {
      maxCount = fillerCounts[word];
      mostCommonFillerWord = word;
    }
  }

  return {
    totalFillerWords,
    fillerWordsPerMinute,
    speakingPace,
    mostCommonFillerWord,
  };
};

export const AnalyticsDashboard = ({ fillerCounts, sessionDuration, transcript }) => {
  const stats = calculateSessionStats(fillerCounts, sessionDuration, transcript);

  const fillerWordDistribution = Object.entries(fillerCounts)
    .filter(([, count]) => count > 0)
    .map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Session Report</CardTitle>
          <CardDescription>A summary of your last practice session.</CardDescription>
        </CardHeader>
      </Card>

      {/* Key Stats Section */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Total Filler Words</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{stats.totalFillerWords}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Filler Words / Min</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{stats.fillerWordsPerMinute}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Common Filler Word</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold capitalize">{stats.mostCommonFillerWord}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Avg. Speaking Pace</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{stats.speakingPace} <span className="text-lg">WPM</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Filler Word Distribution</CardTitle>
            <CardDescription>Breakdown of the filler words used in this session.</CardDescription>
          </CardHeader>
          <CardContent>
            {fillerWordDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={fillerWordDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {fillerWordDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No filler words detected in this session.
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
           <CardHeader>
            <CardTitle>Full Transcript</CardTitle>
            <CardDescription>The complete transcript from your session.</CardDescription>
          </CardHeader>
          <CardContent>
             <div className="bg-gray-50 p-4 rounded-lg max-h-[300px] overflow-y-auto">
              <p className="text-sm text-gray-700 leading-relaxed">
                {transcript || "No transcript available for this session."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
