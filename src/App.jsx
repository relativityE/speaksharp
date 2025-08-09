import React, { useState, useEffect, useCallback } from 'react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { RecordingStatus } from './components/RecordingStatus';
import { FillerWordCounters } from './components/FillerWordCounters';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { ErrorDisplay } from './components/ErrorDisplay';
import { Button } from './components/ui/button';

const TRIAL_DURATION_SECONDS = 120; // 2 minutes

function App() {
  // App view state: 'welcome', 'active_session', 'analytics'
  const [view, setView] = useState('welcome');

  const [isTrialActive, setIsTrialActive] = useState(false);
  const [trialTimeRemaining, setTrialTimeRemaining] = useState(TRIAL_DURATION_SECONDS);
  const [showTrialEndModal, setShowTrialEndModal] = useState(false);

  const [lastSessionData, setLastSessionData] = useState(null);

  const {
    isListening,
    transcript,
    fillerCounts,
    error,
    isSupported,
    startListening,
    stopListening,
    reset,
  } = useSpeechRecognition({});

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

  const handleStartTrial = useCallback(() => {
    reset();
    setLastSessionData(null);
    setTrialTimeRemaining(TRIAL_DURATION_SECONDS);
    setIsTrialActive(true);
    setView('active_session');
    startListening();
  }, [reset, startListening]);

  const handleEndTrialAndShowAnalytics = () => {
    setShowTrialEndModal(false);
    setView('analytics');
    // The data is already stored, so we just change the view
  };

  const handleStartNewSession = () => {
    reset();
    setView('welcome');
  }

  if (!isSupported) {
    return <ErrorDisplay message="Speech recognition is not supported in this browser." />;
  }

  const renderContent = () => {
    switch (view) {
      case 'active_session':
        return (
          <>
            <RecordingStatus
              isListening={isListening}
              sessionActive={isTrialActive}
              sessionDuration={TRIAL_DURATION_SECONDS - trialTimeRemaining}
            />
            {error && <ErrorDisplay message={error} />}
            <div className="session-data">
              <FillerWordCounters counts={fillerCounts} />
              <div className="transcript-container">
                <h2>Transcript</h2>
                <p>{transcript || "Speak to see your words here..."}</p>
              </div>
            </div>
          </>
        );
      case 'analytics':
        return (
          <div>
            <AnalyticsDashboard {...lastSessionData} />
            <Button onClick={handleStartNewSession} className="mt-4">Start a New Session</Button>
          </div>
        );
      case 'welcome':
      default:
        return (
          <>
            <h2>Improve your speaking, one less "um" at a time.</h2>
            <p className="placeholder-text">
              Click the button below to start a free 2-minute trial. <br/>
              No account required. All processing is done locally in your browser.
            </p>
            <Button onClick={handleStartTrial} size="lg">Start 2-Minute Trial</Button>
          </>
        );
    }
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>SayLess</h1>
        <div className="auth-buttons">
          <button className="login-btn">Log In</button>
          <button className="signup-btn">Sign Up</button>
        </div>
      </header>
      <main>
        {renderContent()}
      </main>

      {showTrialEndModal && (
        <div className="trial-modal-overlay">
          <div className="trial-modal-content">
            <h2>Trial Session Ended</h2>
            <p>To save this session and unlock more features, please sign up for an account.</p>
            <button className="signup-btn">Sign Up to Continue</button>
            <Button variant="ghost" onClick={handleEndTrialAndShowAnalytics}>
              Just show me the results
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
