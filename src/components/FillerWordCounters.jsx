import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { FILLER_WORD_KEYS } from '../config';

const colorClasses = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
  green: { bg: 'bg-green-50', text: 'text-green-600' },
  yellow: { bg: 'bg-yellow-50', text: 'text-yellow-600' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-600' },
  pink: { bg: 'bg-pink-50', text: 'text-pink-600' },
};

export const FillerWordCounters = ({ fillerCounts }) => {
  const defaultFillerWords = [
    { key: FILLER_WORD_KEYS.UM, color: 'blue', label: 'Um' },
    { key: FILLER_WORD_KEYS.UH, color: 'green', label: 'Uh' },
    { key: FILLER_WORD_KEYS.LIKE, color: 'yellow', label: 'Like' },
    { key: FILLER_WORD_KEYS.YOU_KNOW, color: 'purple', label: 'You Know' },
    { key: FILLER_WORD_KEYS.SO, color: 'orange', label: 'So' },
    { key: FILLER_WORD_KEYS.ACTUALLY, color: 'pink', label: 'Actually' },
  ];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Filler Word Detection</CardTitle>
        <CardDescription>Real-time tracking of common filler words</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {defaultFillerWords.map(({ key, color, label }) => (
            <div key={key} className={`text-center p-4 rounded-lg ${colorClasses[color].bg}`}>
              <div className={`text-2xl font-bold ${colorClasses[color].text}`}>{fillerCounts[key] || 0}</div>
              <div className="text-sm text-gray-600">{label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
