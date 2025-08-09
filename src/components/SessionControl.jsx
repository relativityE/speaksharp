import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Play, Square } from 'lucide-react';

export const SessionControl = ({
  sessionActive,
  isRecording,
  sessionDuration,
  onStartSession,
  onEndSession,
  onToggleRecording,
  formatTime,
}) => {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-5 w-5" />
          Session Control
          {sessionActive && (
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
          {!sessionActive ? (
            <Button onClick={onStartSession} size="lg" className="bg-green-600 hover:bg-green-700">
              <Play className="h-4 w-4 mr-2" />
              Start New Session
            </Button>
          ) : (
            <>
              <Button
                onClick={onToggleRecording}
                size="lg"
                variant={isRecording ? "destructive" : "default"}
                disabled={!sessionActive}
              >
                {isRecording ? (
                  <>
                    <MicOff className="h-4 w-4 mr-2" />
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
                <Square className="h-4 w-4 mr-2" />
                End Session
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
