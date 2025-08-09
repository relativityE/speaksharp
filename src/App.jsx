import React, { useState, useEffect, useCallback } from 'react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { RecordingStatus } from './components/RecordingStatus';
import { FillerWordCounters } from './components/FillerWordCounters';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { ErrorDisplay } from './components/ErrorDisplay';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { ScrollArea } from './components/ui/scroll-area';

const TRIAL_DURATION_SECONDS = 120; // 2 minutes

function App() {

  const [isTrialActive, setIsTrialActive] = useState(false);
  const [trialTimeRemaining, setTrialTimeRemaining] = useState(TRIAL_DURATION_SECONDS);
  const [showTrialEndModal, setShowTrialEndModal] = useState(false);

  const [lastSessionData, setLastSessionData] = useState(null);

  const [customWord, setCustomWord] = useState('');
  const [customWords, setCustomWords] = useState([]);

  const {
    isListening,
    transcript,
    fillerCounts,
    error,
    isSupported,
    startListening,
    stopListening,
    reset,
  } = useSpeechRecognition({ customWords });

  const handleAddCustomWord = () => {
    if (customWord && !customWords.includes(customWord) && customWords.length === 0) {
      setCustomWords([customWord]);
      setCustomWord('');
    }
  };

  // Trial Timer Logic
  useEffect(() => {
    let timer;
    if (isTrialActive && trialTimeRemaining > 0) {
      timer = setInterval(() => {
        setTrialTimeRemaining(prev => prev - 1);
      }, 1000);
    } else if (isTrialActive && trialTimeRemaining <= 0) {
      setIsTrialActive(false);
      stopListening();
      // Store the session data before showing the modal
      setLastSessionData({
        transcript,
        fillerCounts,
        duration: TRIAL_DURATION_SECONDS * 1000, // in ms
      });
      setShowTrialEndModal(true);
    }
    return () => clearInterval(timer);
  }, [isTrialActive, trialTimeRemaining, stopListening, transcript, fillerCounts]);

  const handleToggleSession = useCallback(() => {
    if (isListening) {
      stopListening();
      setIsTrialActive(false);
    } else {
      reset();
      setCustomWords([]);
      setLastSessionData(null);
      setTrialTimeRemaining(TRIAL_DURATION_SECONDS);
      setIsTrialActive(true);
      startListening();
    }
  }, [isListening, reset, startListening, stopListening]);

  const handleEndTrial = () => {
    // For now, just stop the trial. Analytics view is removed.
    setShowTrialEndModal(false);
  };

  const handleStartNewSession = () => {
    reset();
    setCustomWords([]);
    // No view change needed
  }

  if (!isSupported) {
    return <ErrorDisplay message="Speech recognition is not supported in this browser." />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-4 lg:px-6 h-16 flex items-center border-b">
        <a className="flex items-center justify-center" href="#">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d="M17 6.1H3" />
            <path d="M21 12.1H3" />
            <path d="M15.1 18.1H3" />
          </svg>
          <span className="sr-only">SayLess</span>
        </a>
        <nav className="ml-auto flex gap-4 sm:gap-6">
          {/* Analytics button removed for now */}
        </nav>
      </header>
      <main className="flex-1 w-full">
        <div className="container mx-auto px-4 py-8 md:py-12">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl">
              Speak with Confidence.
            </h1>
            <p className="mt-4 max-w-[700px] mx-auto text-muted-foreground md:text-xl">
              SayLess helps you eliminate filler words and become a more effective communicator.
              Start your free, private 2-minute trial now. No account required.
            </p>
          </div>

          <div className="mx-auto max-w-5xl mt-8">
            <div className="grid gap-8 md:grid-cols-2">
              <div className="flex flex-col gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Your Session</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col items-center justify-center gap-4">
                    <Button onClick={handleToggleSession} size="lg">
                      {isListening ? 'Stop Session' : 'Start 2-Minute Trial'}
                    </Button>
                    <RecordingStatus
                      isListening={isListening}
                      sessionActive={isTrialActive}
                      sessionDuration={TRIAL_DURATION_SECONDS - trialTimeRemaining}
                    />
                  </CardContent>
                </Card>
                <FillerWordCounters
                  fillerCounts={fillerCounts}
                  customWords={customWords}
                  customWord={customWord}
                  setCustomWord={setCustomWord}
                  onAddCustomWord={handleAddCustomWord}
                  isSupported={isSupported}
                  sessionActive={isTrialActive}
                />
              </div>
              <div>
                <Card>
                  <CardHeader>
                    <CardTitle>Live Transcript</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-96 w-full rounded-md border p-4">
                      {transcript || <span className="text-muted-foreground">Speak to see your words here...</span>}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </main>

      <AlertDialog open={showTrialEndModal} onOpenChange={setShowTrialEndModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trial Session Ended</AlertDialogTitle>
            <AlertDialogDescription>
              Your 2-minute trial has ended. Sign up to save your session and unlock more features.
              You can see your final results on the main page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowTrialEndModal(false)}>
              Close
            </AlertDialogCancel>
            <AlertDialogAction>
              Sign Up to Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default App;
