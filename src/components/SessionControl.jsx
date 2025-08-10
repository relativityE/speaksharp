import React from 'react';
import { Button } from './ui/button';
import { Mic, StopCircle } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';

const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const SessionControl = ({ isRecording, onToggle, onEndSession, sessionDuration }) => {
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
          <Button onClick={onToggle} size="lg" className={isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}>
            {isRecording ? (
              <>
                <StopCircle className="h-4 w-4 mr-2" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="h-4 w-4 mr-2" />
                Start Recording
              </>
            )}
          </Button>
          <Button onClick={onEndSession} variant="outline" size="lg">
            End Session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
