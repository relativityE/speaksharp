import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

// A simple diffing function to highlight differences
const diffWords = (text1, text2) => {
  const words1 = text1.split(/\s+/);
  const words2 = text2.split(/\s+/);
  const maxLen = Math.max(words1.length, words2.length);
  const result1 = [];
  const result2 = [];

  for (let i = 0; i < maxLen; i++) {
    const word1 = words1[i] || '';
    const word2 = words2[i] || '';
    if (word1 !== word2) {
      result1.push(<mark key={`1-${i}`} className="bg-red-200">{word1} </mark>);
      result2.push(<mark key={`2-${i}`} className="bg-green-200">{word2} </mark>);
    } else {
      result1.push(<span key={`1-${i}`}>{word1} </span>);
      result2.push(<span key={`2-${i}`}>{word2} </span>);
    }
  }
  return { diff1: result1, diff2: result2 };
};


export const ComparisonView = ({ browserTranscript, cloudTranscript }) => {
  if (!cloudTranscript) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{browserTranscript}</p>
        </CardContent>
      </Card>
    );
  }

  const { diff1, diff2 } = diffWords(browserTranscript, cloudTranscript);
  const browserWordCount = browserTranscript.split(/\s+/).length;
  const cloudWordCount = cloudTranscript.split(/\s+/).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transcript Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-semibold">Browser Transcript</h3>
            <p className="text-sm text-muted-foreground mb-2">Word Count: {browserWordCount}</p>
            <Separator />
            <div className="mt-4 p-4 bg-muted rounded-md text-sm leading-relaxed">{diff1}</div>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Cloud Transcript (High-Accuracy)</h3>
            <p className="text-sm text-muted-foreground mb-2">Word Count: {cloudWordCount}</p>
            <Separator />
            <div className="mt-4 p-4 bg-muted rounded-md text-sm leading-relaxed">{diff2}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
