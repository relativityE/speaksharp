import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';

const FillerWordCounter = ({ word, data, maxCount }) => {
    const { count, color } = data;
    const [displayCount, setDisplayCount] = useState(count);
    const [isAnimating, setIsAnimating] = useState(false);
    const progress = maxCount > 0 ? (count / maxCount) * 100 : 0;

    useEffect(() => {
        if (count !== displayCount) {
            setIsAnimating(true);
            setDisplayCount(count);
            const timer = setTimeout(() => setIsAnimating(false), 300); // Animation duration
            return () => clearTimeout(timer);
        }
    }, [count, displayCount]);

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-muted-foreground">{word}</span>
                </div>
                <span className={`font-bold text-foreground transition-colors duration-300 ${isAnimating ? 'text-primary' : ''}`}>
                    {displayCount}
                </span>
            </div>
            <Progress value={progress} style={{ '--progress-color': color }} className="h-1 [&>div]:bg-[--progress-color]" />
        </div>
    );
};

export const FillerWordAnalysis = ({ fillerData, customWords, setCustomWords }) => {
    const sortedFillerWords = Object.entries(fillerData).sort(([, a], [, b]) => b.count - a.count);
    const maxCount = Math.max(...Object.values(fillerData).map(d => d.count), 0);

    const [newWord, setNewWord] = useState('');

    const addWord = () => {
        if (newWord && !customWords.includes(newWord.toLowerCase())) {
            setCustomWords(prev => [...prev, newWord.toLowerCase().trim()]);
            setNewWord('');
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            addWord();
        }
    }

    const removeWord = (wordToRemove) => {
        setCustomWords(prev => prev.filter(word => word !== wordToRemove));
    };

    return (
        <Card>
            <CardHeader className="p-4">
                <CardTitle className="text-lg">Filler Word Analysis</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
                {sortedFillerWords.length > 0 ? sortedFillerWords.map(([word, data]) => (
                    <FillerWordCounter key={word} word={word} data={data} maxCount={maxCount} />
                )) : (
                    <p className="text-muted-foreground">Start speaking to see your analysis.</p>
                )}

                <Separator className="my-4" />

                <div className="space-y-3">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-medium text-muted-foreground">Custom Words</h4>
                                    <Badge variant="outline">PRO</Badge>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Track words or phrases unique to your vocabulary. <br />This is a Pro feature.</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <p className="text-xs text-muted-foreground -mt-2">
                        Define your own filler words to get a more personalized analysis.
                    </p>
                    <div className="flex gap-2">
                        <Input
                            type="text"
                            value={newWord}
                            onChange={(e) => setNewWord(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Add a word to track..."
                            className="bg-input"
                        />
                        <Button onClick={addWord} variant="secondary" size="icon">
                            <Plus size={16} />
                        </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                        {customWords.map(word => (
                            <Badge key={word} variant="secondary" className="flex items-center gap-2">
                                <span>{word}</span>
                                <button onClick={() => removeWord(word)} className="text-muted-foreground hover:text-foreground">
                                    <Trash2 size={12} />
                                </button>
                            </Badge>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
