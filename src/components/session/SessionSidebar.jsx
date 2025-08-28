import React from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorDisplay } from '../ErrorDisplay';

// This is a simplified sidebar for the new self-contained hook.
// The complex logic for saving sessions, upgrade prompts, etc., has been
// temporarily removed to focus on getting the core transcription working.
export const SessionSidebar = ({
  isListening,
  isLoading,
  error,
  startListening,
  stopListening,
  elapsedTime,
}) => {
  const getCardTitle = () => {
    if (isLoading && !isListening) return 'Session Status: Connecting...';
    if (isListening) return 'Session Status: Cloud AI';
    return 'Session Status: Ready';
  };

  const isButtonDisabled = isLoading;

  return (
    <div className="flex flex-col gap-6 h-full">
      <Card className="w-full flex flex-col flex-grow">
        <CardHeader>
          <CardTitle className="text-sm font-bold text-center p-2 rounded-lg bg-card-foreground/5 text-card-foreground shadow-inner">
            {getCardTitle()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 flex-grow flex flex-col">
          <ErrorDisplay error={error ? { message: error } : null} />
          <div className="flex flex-col items-center justify-center gap-6 py-2 flex-grow">
            <div className="bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg">
              <div className="text-2xl font-mono font-bold tracking-widest">
                {`${String(Math.floor(elapsedTime / 60)).padStart(2, '0')}:${String(elapsedTime % 60).padStart(2, '0')}`}
              </div>
            </div>
            <div className={`text-xl font-semibold ${isListening ? 'text-green-500' : 'text-muted-foreground'}`}>
              {isLoading && !isListening ? '○ Connecting...' : (isListening ? '● Listening...' : 'Idle')}
            </div>
            <Button
              onClick={isListening ? stopListening : startListening}
              size="lg"
              variant={isListening ? 'destructive' : 'default'}
              className="w-full h-16 text-xl font-bold rounded-lg"
              disabled={isButtonDisabled}
            >
              {isLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting...</> : (isListening ? <><Square className="w-4 h-4 mr-2" /> Stop</> : <><Mic className="w-4 h-4 mr-2" /> Start</>)}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
