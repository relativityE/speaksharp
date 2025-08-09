import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BarChart3, Plus } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { FILLER_WORD_KEYS } from '../config';


const colorClasses = {
  blue: { bg: 'bg-blue-100', text: 'text-blue-800' },
  green: { bg: 'bg-green-100', text: 'text-green-800' },
  yellow: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  purple: { bg: 'bg-purple-100', text: 'text-purple-800' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-800' },
  pink: { bg: 'bg-pink-100', text: 'text-pink-800' },
  teal: { bg: 'bg-teal-100', text: 'text-teal-800' },
  cyan: { bg: 'bg-cyan-100', text: 'text-cyan-800' },
  indigo: { bg: 'bg-indigo-100', text: 'text-indigo-800' },
};

export const FillerWordCounters = ({
  fillerCounts,
  customWords,
  customWord,
  setCustomWord,
  onAddCustomWord,
  sessionActive,
  totalFillerWords,
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

  const handleAddClick = () => {
    if (customWord.trim()) {
      onAddCustomWord(customWord.trim());
      setCustomWord('');
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Filler Word Detection
          </CardTitle>
          <div className="text-sm text-muted-foreground">
            Total: <span className="font-semibold text-foreground">{totalFillerWords}</span>
          </div>
        </div>
        <CardDescription>
          Real-time tracking of common and custom filler words.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {defaultFillerWords.map(({ key, color, label }) => (
            <Card key={key} className={`text-center ${colorClasses[color].bg}`}>
              <CardContent className="p-4 flex flex-col justify-center items-center h-full">
                <div className={`text-3xl font-bold ${colorClasses[color].text}`}>{fillerCounts[key] || 0}</div>
                <div className="text-sm text-muted-foreground mt-1">{label}</div>
              </CardContent>
            </Card>
          ))}
          {customWords.map((word) => (
            <Card key={word} className="text-center bg-gray-100">
              <CardContent className="p-4 flex flex-col justify-center items-center h-full">
                <div className="text-3xl font-bold">{fillerCounts[word] || 0}</div>
                <div className="text-sm text-muted-foreground capitalize mt-1">{word}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-6 flex items-center gap-2">
          <Label htmlFor="custom-word" className="whitespace-nowrap">Custom Word</Label>
          <Input
            id="custom-word"
            type="text"
            placeholder="Add a word to track..."
            value={customWord}
            onChange={(e) => setCustomWord(e.target.value)}
            disabled={!sessionActive}
          />
          <Button onClick={handleAddClick} disabled={!sessionActive || !customWord.trim()} size="icon">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
