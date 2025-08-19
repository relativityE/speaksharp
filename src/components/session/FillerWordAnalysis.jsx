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

const FillerWordCard = ({ word, count, colorClass, progress }) => (
  <div className={`p-3 rounded-lg text-left ${colorClass}`}>
    <div className="flex justify-between items-center mb-2">
      <span className="text-md font-semibold text-gray-800 capitalize">{word}</span>
      <span className="text-xl font-bold text-gray-900">{count}</span>
    </div>
    <Progress value={progress} className="h-2 [&>*]:bg-gray-600" />
  </div>
);

import { cn } from '@/lib/utils';

const FillerWordAnalysis = ({ fillerData, customWords, addCustomWord, defaultFillerWords, className }) => {
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

  const maxCount = Math.max(10, sortedWords.length > 0 ? sortedWords[0].count : 0);

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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-6">
          {sortedWords.map(({ word, count }, index) => {
            const progress = maxCount > 0 ? (count / maxCount) * 100 : 0;
            const colorClass = getSeverityColor(index);
            return (
              <FillerWordCard
                key={word}
                word={word}
                count={count}
                colorClass={colorClass}
                progress={progress}
              />
            );
          })}
        </div>

        <form onSubmit={handleAddWord} className="flex items-center gap-2 mt-8">
          <label htmlFor="custom-word" className="text-sm font-medium">
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
