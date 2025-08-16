import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from 'lucide-react';

const FillerWordBox = ({ word, count, color }) => (
  <div
    className="flex flex-col items-center justify-center p-4 rounded-lg text-center"
    style={{ backgroundColor: color }}
  >
    <span className="text-lg font-semibold text-gray-800 capitalize">{word}</span>
    <span className="text-2xl font-bold text-gray-900">{count}</span>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Filler Word Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 mb-6">
          {allWords.map((word) => {
            const data = fillerData[word] || { count: 0, color: '#E5E7EB' };
            return (
              <FillerWordBox
                key={word}
                word={word}
                count={data.count}
                color={data.color}
              />
            );
          })}
        </div>

        <form onSubmit={handleAddWord} className="flex items-center gap-2">
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
