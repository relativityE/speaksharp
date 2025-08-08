import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BarChart3, Plus } from 'lucide-react';
import { FILLER_WORD_KEYS } from '../config';

const colorClasses = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
  green: { bg: 'bg-green-50', text: 'text-green-600' },
  yellow: { bg: 'bg-yellow-50', text: 'text-yellow-600' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-600' },
  pink: { bg: 'bg-pink-50', text: 'text-pink-600' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-600' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600' },
};

export const FillerWordCounters = ({
  fillerCounts,
  customWords,
  customWord,
  setCustomWord,
  onAddCustomWord,
  isSupported,
  sessionActive,
}) => {
  const defaultFillerWords = [
    { key: FILLER_WORD_KEYS.UM, color: 'blue', label: 'Um' },
    { key: FILLER_WORD_KEYS.UH, color: 'green', label: 'Uh' },
    { key: FILLER_WORD_KEYS.AH, color: 'indigo', label: 'Ah' },
    { key: FILLER_WORD_KEYS.LIKE, color: 'yellow', label: 'Like' },
    { key: FILLER_WORD_KEYS.YOU_KNOW, color: 'purple', label: 'You Know' },
    { key: FILLER_WORD_KEYS.SO, color: 'orange', label: 'So' },
    { key: FILLER_WORD_KEYS.ACTUALLY, color: 'pink', label: 'Actually' },
    { key: FILLER_WORD_KEYS.OH, color: 'teal', label: 'Oh' },
    { key: FILLER_WORD_KEYS.I_MEAN, color: 'cyan', label: 'I Mean' },
  ];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Filler Word Detection
          {!isSupported && (
            <Badge variant="secondary" className="text-xs">
              Manual Mode
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {isSupported
            ? "Real-time tracking of common filler words. Add your own word to track below."
            : "Filler word counts (requires manual input in this browser)"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {defaultFillerWords.map(({ key, color, label }) => (
            <div key={key} className={`text-center p-4 ${colorClasses[color].bg} rounded-lg`}>
              <div className={`text-2xl font-bold ${colorClasses[color].text}`}>{fillerCounts[key] || 0}</div>
              <div className="text-sm text-gray-600">{label}</div>
            </div>
          ))}
          {customWords.map((word) => (
            <div key={word} className="text-center p-4 bg-gray-100 rounded-lg">
              <div className="text-2xl font-bold text-gray-800">{fillerCounts[word] || 0}</div>
              <div className="text-sm text-gray-600 capitalize">{word}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex w-full max-w-sm items-center space-x-2 mx-auto">
          <Input
            type="text"
            placeholder="Add custom word..."
            value={customWord}
            onChange={(e) => setCustomWord(e.target.value)}
            disabled={!sessionActive || customWords.length > 0}
          />
          <Button
            type="button"
            onClick={onAddCustomWord}
            disabled={!sessionActive || !customWord || customWords.length > 0}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Word
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
