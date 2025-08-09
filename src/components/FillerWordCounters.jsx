import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BarChart3, Plus, Save } from 'lucide-react';
import { FILLER_WORD_KEYS } from '../config';

const colorClasses = {
  blue: { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-600 dark:text-blue-300' },
  green: { bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-600 dark:text-green-300' },
  yellow: { bg: 'bg-yellow-100 dark:bg-yellow-900', text: 'text-yellow-600 dark:text-yellow-300' },
  purple: { bg: 'bg-purple-100 dark:bg-purple-900', text: 'text-purple-600 dark:text-purple-300' },
  orange: { bg: 'bg-orange-100 dark:bg-orange-900', text: 'text-orange-600 dark:text-orange-300' },
  pink: { bg: 'bg-pink-100 dark:bg-pink-900', text: 'text-pink-600 dark:text-pink-300' },
  teal: { bg: 'bg-teal-100 dark:bg-teal-900', text: 'text-teal-600 dark:text-teal-300' },
  cyan: { bg: 'bg-cyan-100 dark:bg-cyan-900', text: 'text-cyan-600 dark:text-cyan-300' },
  indigo: { bg: 'bg-indigo-100 dark:bg-indigo-900', text: 'text-indigo-600 dark:text-indigo-300' },
};

export const FillerWordCounters = ({
  fillerCounts,
  customWords,
  customWord,
  setCustomWord,
  onAddCustomWord,
  sessionActive,
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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

  const handleSave = () => {
    if (customWord.trim()) {
      onAddCustomWord(customWord.trim());
      setCustomWord('');
      setIsDialogOpen(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Filler Word Detection
          </CardTitle>
          <CardDescription>
            Real-time tracking of common and custom filler words.
          </CardDescription>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={!sessionActive}>
              <Plus className="h-4 w-4 mr-2" />
              Add Word
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add Custom Filler Word</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Input
                id="custom-word"
                placeholder="e.g., 'basically'"
                value={customWord}
                onChange={(e) => setCustomWord(e.target.value)}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={handleSave} disabled={!customWord.trim()}>
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
            <Card key={word} className="text-center bg-card">
              <CardContent className="p-4 flex flex-col justify-center items-center h-full">
                <div className="text-3xl font-bold text-primary">{fillerCounts[word] || 0}</div>
                <div className="text-sm text-muted-foreground capitalize mt-1">{word}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
