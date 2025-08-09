import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { RecordingStatus } from './components/RecordingStatus';
import { FillerWordCounters } from './components/FillerWordCounters';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { ErrorDisplay } from './components/ErrorDisplay';
import { Button } from './components/ui/button';
import { Header } from './components/Header';
import { SessionControl } from './components/SessionControl';
import { InfoCard } from './components/InfoCard';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';

const TRIAL_DURATION_SECONDS = 120;

function App() {
  const navigate = useNavigate();
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

  useEffect(() => {
    let timer;
    if (isListening && trialTimeRemaining > 0) {
      timer = setInterval(() => {
        setTrialTimeRemaining(prev => prev - 1);
      }, 1000);
    } else if (isListening && trialTimeRemaining <= 0) {
      stopListening();
      setLastSessionData({ transcript, fillerCounts, duration: TRIAL_DURATION_SECONDS * 1000 });
      setShowTrialEndModal(true);
    }
    return () => clearInterval(timer);
  }, [isListening, trialTimeRemaining, stopListening, transcript, fillerCounts]);

  const handleToggleRecording = useCallback(() => {
    if (isListening) {
      stopListening();
      setLastSessionData({
        transcript,
        fillerCounts,
        duration: TRIAL_DURATION_SECONDS - trialTimeRemaining,
      });
      navigate('/analytics');
    } else {
      reset();
      setLastSessionData(null);
      setTrialTimeRemaining(TRIAL_DURATION_SECONDS);
      navigate('/session');
      startListening();
    }
  }, [isListening, stopListening, startListening, reset, navigate, transcript, fillerCounts, trialTimeRemaining]);

  const handleEndTrialAndShowAnalytics = () => {
    setShowTrialEndModal(false);
    navigate('/analytics');
  };

  const totalFillerWords = Object.values(fillerCounts).reduce((sum, count) => sum + count, 0);

  if (!isSupported) {
    return <ErrorDisplay message="Speech recognition is not supported in this browser." />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Header />
      <main className="max-w-4xl mx-auto">
        <Routes>
          <Route path="/" element={
            <div className="text-center mt-8">
              <h1 className="text-4xl font-bold text-gray-900 mb-2">ClearSpeak AI</h1>
              <p className="text-lg text-gray-600 mb-8">Real-time filler word detection for better speaking</p>
              <SessionControl
                isRecording={isListening}
                onToggle={handleToggleRecording}
                sessionDuration={TRIAL_DURATION_SECONDS - trialTimeRemaining}
              />
            </div>
          } />
          <Route path="/session" element={
            <div className="flex flex-col gap-6 mt-6">
              <SessionControl
                isRecording={isListening}
                onToggle={handleToggleRecording}
                sessionDuration={TRIAL_DURATION_SECONDS - trialTimeRemaining}
              />
              <RecordingStatus
                isRecording={isListening}
              />
              <FillerWordCounters
                fillerCounts={fillerCounts}
                customWords={customWords}
                customWord={customWord}
                setCustomWord={setCustomWord}
                onAddCustomWord={handleAddCustomWord}
                sessionActive={isListening}
                totalFillerWords={totalFillerWords}
              />
              <div className="grid md:grid-cols-2 gap-6">
                <InfoCard title="Privacy First">
                  All processing happens on your device using browser APIs. Your speech never leaves your device.
                </InfoCard>
                <InfoCard title="Real-time Feedback">
                  Get instant feedback on your speech patterns to improve your communication skills.
                </InfoCard>
              </div>
            </div>
          } />
          <Route path="/analytics" element={
            <AnalyticsDashboard {...lastSessionData} />
          } />
        </Routes>
      </main>
      {showTrialEndModal && (
        <div className="trial-modal-overlay">
          <div className="trial-modal-content">
            <h2>Trial Session Ended</h2>
            <p>To save this session and unlock more features, please sign up for an account.</p>
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
