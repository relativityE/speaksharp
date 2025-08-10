import React from 'react';
import { Button } from './ui/button';
import { Mic, Square } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';

const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const SessionControl = ({ isRecording, onStart, onEnd, sessionDuration }) => {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-5 w-5" />
          Session Control
          {isRecording && (
            <Badge variant="outline" className="ml-auto">
              {formatTime(sessionDuration)}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Start a new session to begin tracking your speech patterns
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 justify-center">
          <Button onClick={onStart} size="lg" className="bg-green-600 hover:bg-green-700">
            <Mic className="h-4 w-4 mr-2" />
            Start Recording
          </Button>
          <Button onClick={onEnd} variant="outline" size="lg">
            <Square className="h-4 w-4 mr-2" />
            End Session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
