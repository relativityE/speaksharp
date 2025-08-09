import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimerIcon, StopCircle } from 'lucide-react';

// Helper to format time from seconds into MM:SS format
const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const RecordingStatus = ({ sessionActive, sessionDuration, onStop }) => {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 ${sessionActive ? 'text-destructive' : 'text-muted-foreground'}`}>
              <div className={`w-3 h-3 rounded-full ${sessionActive ? 'bg-destructive animate-pulse' : 'bg-muted-foreground'}`}></div>
              <span className="font-medium">{sessionActive ? 'Recording' : 'Idle'}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <TimerIcon className="h-5 w-5" />
              <p className="text-lg font-semibold tracking-tighter text-foreground">
                {formatTime(sessionDuration)}
              </p>
            </div>
          </div>
          <Button onClick={onStop} variant="destructive" disabled={!sessionActive}>
            <StopCircle className="h-4 w-4 mr-2" />
            Stop Recording
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
