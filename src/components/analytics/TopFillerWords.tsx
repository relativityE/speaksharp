import React from 'react';
import { useSession } from '@/contexts/SessionContext';
import { calculateTopFillerWords } from '@/lib/analyticsUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const TopFillerWords: React.FC = () => {
  const { sessionHistory } = useSession();
  const topWords = calculateTopFillerWords(sessionHistory || []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 2 Filler Words</CardTitle>
      </CardHeader>
      <CardContent>
        {topWords.length > 0 ? (
          <ul className="space-y-2">
            {topWords.map((word, index) => (
              <li key={index} className="text-lg">
                {index + 1}. {word}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No filler words detected in recent sessions.</p>
        )}
      </CardContent>
    </Card>
  );
};