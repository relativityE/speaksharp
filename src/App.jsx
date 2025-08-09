import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { RecordingStatus } from './components/RecordingStatus';
import { FillerWordCounters } from './components/FillerWordCounters';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { ErrorDisplay } from './components/ErrorDisplay';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { Button } from './components/ui/button';

const TRIAL_DURATION_SECONDS = 120; // 2 minutes

function App() {
  const navigate = useNavigate();
  const [isTrialActive, setIsTrialActive] = useState(false);
  const [trialTimeRemaining, setTrialTimeRemaining] = useState(TRIAL_DURATION_SECONDS);
  const [showTrialEndModal, setShowTrialEndModal] = useState(false);
  const [lastSessionData, setLastSessionData] = useState(null);
  const [customWords, setCustomWords] = useState([]);
  const [customWord, setCustomWord] = useState('');

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

  const handleAddCustomWord = (word) => {
    if (word && !customWords.includes(word)) {
      setCustomWords([...customWords, word]);
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

  const handleStartTrial = useCallback(() => {
    reset();
    setLastSessionData(null);
    setTrialTimeRemaining(TRIAL_DURATION_SECONDS);
    setIsTrialActive(true);
    navigate('/session');
    startListening();
  }, [reset, startListening, navigate]);

  const handleStopTrial = useCallback(() => {
    setIsTrialActive(false);
    stopListening();
    setLastSessionData({
      transcript,
      fillerCounts,
      duration: TRIAL_DURATION_SECONDS - trialTimeRemaining,
    });
    navigate('/analytics');
  }, [stopListening, transcript, fillerCounts, trialTimeRemaining, navigate]);

  const handleEndTrialAndShowAnalytics = () => {
    setShowTrialEndModal(false);
    navigate('/analytics');
  };

  const handleStartNewSession = () => {
    reset();
    navigate('/');
  }

  if (!isSupported) {
    return <ErrorDisplay message="Speech recognition is not supported in this browser." />;
  }

  return (
    <div className="App">
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Hero onStartTrial={handleStartTrial} />} />
          <Route path="/session" element={
            <div className="grid md:grid-cols-2 gap-8">
              {/* Left Column */}
              <div className="flex flex-col gap-6">
                <RecordingStatus
                  isListening={isListening}
                  sessionActive={isTrialActive}
                  sessionDuration={TRIAL_DURATION_SECONDS - trialTimeRemaining}
                  onStop={handleStopTrial}
                />
                <FillerWordCounters
                  fillerCounts={fillerCounts}
                  customWords={customWords}
                  customWord={customWord}
                  setCustomWord={setCustomWord}
                  onAddCustomWord={handleAddCustomWord}
                  sessionActive={isTrialActive}
                />
              </div>

              {/* Right Column */}
              <div>
                <h2 className="text-2xl font-bold mb-4">Live Transcript</h2>
                <div className="h-96 p-4 border rounded-lg overflow-y-auto bg-card">
                  <p>{transcript || "Speak to see your words here..."}</p>
                </div>
              </div>
            </div>
          } />
          <Route path="/analytics" element={
            <div>
              <AnalyticsDashboard {...lastSessionData} />
              <Button onClick={handleStartNewSession} className="mt-4">Start a New Session</Button>
            </div>
          } />
        </Routes>
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
