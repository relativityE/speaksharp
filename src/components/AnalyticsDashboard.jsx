import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAnalyticsData } from '@/hooks/useAnalyticsData';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF1919'];

export const AnalyticsDashboard = () => {
  const { data, isLoading, error } = useAnalyticsData();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error loading data.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Key Stats Section */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Total Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{data.keyStats.totalSessions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Filler Words / Min</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{data.keyStats.averageFillerWordsPerMinute}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Common Filler Word</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold capitalize">{data.keyStats.mostCommonFillerWord}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Avg. Speaking Pace</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{data.keyStats.speakingPace} <span className="text-lg">WPM</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Filler Word Trends</CardTitle>
            <CardDescription>Filler words used per session over time.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.sessionTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="fillerWords" fill="#8884d8" name="Filler Words" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Filler Word Distribution</CardTitle>
            <CardDescription>Breakdown of your most used filler words.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data.fillerWordDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  nameKey="name"
                  label={(props) => `${props.name} (${props.value})`}
                >
                  {data.fillerWordDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Session History Section */}
      <Card>
        <CardHeader>
          <CardTitle>Session History</CardTitle>
          <CardDescription>A log of your most recent practice sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Filler Words</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sessionHistory.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">{session.title}</TableCell>
                  <TableCell>{session.date}</TableCell>
                  <TableCell>{session.duration}</TableCell>
                  <TableCell>{session.totalFillerWords}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
