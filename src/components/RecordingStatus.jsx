import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TimerIcon } from 'lucide-react';

// Helper to format time from seconds into MM:SS format
const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const RecordingStatus = ({ sessionActive, sessionDuration }) => {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-center text-muted-foreground font-normal text-sm">
          Session Timer
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-center space-y-4">
          {/* Timer Display */}
          <div className="flex items-center justify-center gap-2">
            <TimerIcon className="h-8 w-8 text-primary" />
            <p className="text-5xl font-bold tracking-tighter text-foreground">
              {formatTime(sessionDuration)}
            </p>
          </div>

          {/* Recording Indicator */}
          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
              sessionActive
                ? 'bg-destructive/10 text-destructive'
                : 'bg-secondary text-secondary-foreground'
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                sessionActive ? 'bg-destructive animate-pulse' : 'bg-muted-foreground'
              }`}
            ></div>
            {sessionActive ? 'Recording...' : 'Not Recording'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
