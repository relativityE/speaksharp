import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Plus } from 'lucide-react';

const COOL_TONE_PALETTE = [
  'bg-blue-100', 'bg-indigo-100', 'bg-purple-100',
  'bg-blue-200', 'bg-indigo-200', 'bg-purple-200',
];

const FillerWordCard = ({ word, count, colorClass, progress }) => (
  <div className={`p-4 rounded-lg text-left ${colorClass}`}>
    <div className="flex justify-between items-center mb-2">
      <span className="text-lg font-semibold text-gray-800 capitalize">{word}</span>
      <span className="text-2xl font-bold text-gray-900">{count}</span>
    </div>
    <Progress value={progress} className="h-2 [&>*]:bg-gray-600" />
  </div>
);

const FillerWordAnalysis = ({ fillerData, customWords, addCustomWord, defaultFillerWords }) => {
  const [newWord, setNewWord] = useState('');

  const handleAddWord = (e) => {
    e.preventDefault();
    if (newWord && !customWords.includes(newWord.toLowerCase()) && !defaultFillerWords.includes(newWord.toLowerCase())) {
      addCustomWord(newWord.toLowerCase());
      setNewWord('');
    }
  };

  const allWords = [...defaultFillerWords, ...customWords];
  const maxCount = Math.max(10, ...allWords.map(word => (fillerData[word] ? fillerData[word].count : 0)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Filler Word Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-6">
          {allWords.map((word, index) => {
            const data = fillerData[word] || { count: 0 };
            const progress = maxCount > 0 ? (data.count / maxCount) * 100 : 0;
            const colorClass = COOL_TONE_PALETTE[index % COOL_TONE_PALETTE.length];
            return (
              <FillerWordCard
                key={word}
                word={word}
                count={data.count}
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
