import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BarChart3, Plus } from 'lucide-react';
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
  const [isAdding, setIsAdding] = useState(false);

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
    onAddCustomWord();
    setIsAdding(false);
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Filler Word Detection
        </CardTitle>
        <CardDescription>
          Real-time tracking of common filler words. You can add one custom word to track.
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
            <Card key={word} className="text-center bg-gray-100 dark:bg-gray-800">
              <CardContent className="p-4 flex flex-col justify-center items-center h-full">
                <div className="text-3xl font-bold">{fillerCounts[word] || 0}</div>
                <div className="text-sm text-muted-foreground capitalize mt-1">{word}</div>
              </CardContent>
            </Card>
          ))}
          {customWords.length === 0 && (
            isAdding ? (
              <Card className="text-center bg-gray-100 dark:bg-gray-800">
                <CardContent className="p-4 flex flex-col justify-center items-center h-full gap-2">
                  <Input
                    type="text"
                    placeholder="Enter word..."
                    value={customWord}
                    onChange={(e) => setCustomWord(e.target.value)}
                    disabled={!sessionActive}
                    className="h-9"
                  />
                  <Button onClick={handleSave} disabled={!sessionActive || !customWord} size="sm">
                    <Save className="h-4 w-4 mr-2" />
                    Save
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card
                className="text-center border-dashed border-2 hover:border-primary cursor-pointer"
                onClick={() => sessionActive && setIsAdding(true)}
              >
                <CardContent className="p-4 flex flex-col justify-center items-center h-full text-muted-foreground">
                  <Plus className="h-8 w-8 mb-2" />
                  <span>Add Custom Word</span>
                </CardContent>
              </Card>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
};
