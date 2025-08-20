import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Plus } from 'lucide-react';

// Severity-based palette with good contrast for black text (WCAG AA compliant)
const SEVERITY_PALETTE = {
  high: 'bg-red-300',
  medium: 'bg-yellow-300',
  low: 'bg-green-300',
  default: 'bg-indigo-200',
};

const FillerWordCard = ({ word, count, colorClass }) => (
  <div className={`p-4 rounded-lg text-center ${colorClass} transition-transform hover:scale-105`}>
    <div className="text-3xl font-bold text-gray-800">{count}</div>
    <div className="text-sm font-semibold text-gray-700 capitalize mt-1">{word}</div>
  </div>
);

import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';

const FillerWordAnalysis = ({ fillerData = {}, customWords, addCustomWord, defaultFillerWords, className }) => {
  const [newWord, setNewWord] = useState('');

  const handleAddWord = (e) => {
    e.preventDefault();
    if (newWord && !customWords.includes(newWord.toLowerCase()) && !defaultFillerWords.includes(newWord.toLowerCase())) {
      addCustomWord(newWord.toLowerCase());
      setNewWord('');
    }
  };

  const allWords = [...defaultFillerWords, ...customWords];

  const sortedWords = allWords
    .map(word => ({ word, count: fillerData[word] ? fillerData[word].count : 0 }))
    .sort((a, b) => b.count - a.count);

  const hasData = sortedWords.some(word => word.count > 0);

  const maxCount = Math.max(10, hasData ? sortedWords[0].count : 0);

  const getSeverityColor = (index) => {
    if (index === 0) return SEVERITY_PALETTE.high;
    if (index <= 2) return SEVERITY_PALETTE.medium;
    if (index <= 4) return SEVERITY_PALETTE.low;
    return SEVERITY_PALETTE.default;
  };

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle>Filler Word Analysis</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col flex-grow">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-6">
          {hasData ? (
            sortedWords.map(({ word, count }, index) => {
              if (count === 0) return null; // Don't render cards for words with 0 count
              const colorClass = getSeverityColor(index);
              return (
                <FillerWordCard
                  key={word}
                  word={word}
                  count={count}
                  colorClass={colorClass}
                />
              );
            })
          ) : (
            <div className="col-span-full">
              <EmptyState
                title="No Filler Words Detected Yet"
                description="Start speaking to see your filler word analysis here. Your most frequent words will appear at the top."
              />
            </div>
          )}
        </div>

        <form onSubmit={handleAddWord} className="flex items-center gap-2 mt-auto pt-4">
          <label htmlFor="custom-word" className="text-xs font-medium">
            Custom Filler Word:
          </label>
          <Input
            id="custom-word"
            type="text"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="e.g., basically"
            className="flex-grow"
          />
          <Button type="submit" size="icon" aria-label="Add custom filler word">
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default FillerWordAnalysis;
