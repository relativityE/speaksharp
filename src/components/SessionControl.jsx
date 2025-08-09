import React from 'react';
import { Button } from './ui/button';
import { Mic, StopCircle } from 'lucide-react';
import { Badge } from './ui/badge';

const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const SessionControl = ({ isRecording, onToggle, sessionDuration }) => {
  return (
    <div className="flex gap-4 justify-center items-center">
      <Button onClick={onToggle} size="lg">
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
      {isRecording && (
        <Badge variant="outline" className="text-lg">
          {formatTime(sessionDuration)}
        </Badge>
      )}
    </div>
  );
};
