import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Zap, Cpu, Save, Trash2, Play, StopCircle } from 'lucide-react';

const SessionSidebar = ({ isListening, startListening, stopListening, reset, mode, setMode, saveSession }) => {

  const handleStopAndSave = async () => {
    const sessionData = await stopListening();
    if (sessionData) {
      saveSession(sessionData);
    }
  };

  const handleModeChange = (newMode) => {
    // Only update if a new mode is selected.
    if (newMode) {
      setMode(newMode);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Session Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isListening ? (
            <Button onClick={startListening} className="w-full" size="lg">
              <Play className="mr-2 h-5 w-5" /> Start Recording
            </Button>
          ) : (
            <Button onClick={handleStopAndSave} className="w-full" variant="destructive" size="lg">
              <StopCircle className="mr-2 h-5 w-5" /> Stop & Save
            </Button>
          )}
          <Button onClick={reset} disabled={isListening} className="w-full" variant="outline">
            <Trash2 className="mr-2 h-5 w-5" /> Reset Transcript
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcription Mode</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor="transcription-mode">Select Engine</Label>
          <ToggleGroup
            id="transcription-mode"
            type="single"
            value={mode}
            onValueChange={handleModeChange}
            disabled={isListening} // The toggle is locked when a session is active.
            className="grid grid-cols-2 gap-2 mt-2"
          >
            <ToggleGroupItem value="cloud" aria-label="Cloud Mode" className="flex flex-col h-auto py-2">
              <Zap className="h-5 w-5 mb-1" />
              <span>Cloud</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="local" aria-label="Local Mode" className="flex flex-col h-auto py-2">
              <Cpu className="h-5 w-5 mb-1" />
              <span>Local</span>
            </ToggleGroupItem>
            {/* The 'native' option has been removed from the UI to prevent selection. */}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground mt-2">
            {mode === 'cloud'
              ? 'Faster, higher accuracy. Requires internet.'
              : 'Runs entirely in your browser. Slower, but privacy-focused.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SessionSidebar;
