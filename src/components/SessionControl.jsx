import React from 'react';
import { Button } from './ui/button';
import { Mic, StopCircle } from 'lucide-react';

const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const SessionControl = ({ isRecording, onToggle, sessionDuration }) => {
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <Button onClick={onToggle} size="lg" variant={isRecording ? 'destructive' : 'default'}>
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
        <div className="text-lg font-semibold">
          {formatTime(sessionDuration)}
        </div>
      )}
    </div>
  );
};
