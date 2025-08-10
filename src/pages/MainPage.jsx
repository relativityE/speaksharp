import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { RecordingStatus } from '../components/RecordingStatus';
import { FillerWordCounters } from '../components/FillerWordCounters';
import { SessionControl } from '../components/SessionControl';
import { InfoCard } from '../components/InfoCard';

const TRIAL_DURATION_SECONDS = 120;

export const MainPage = () => {
  const navigate = useNavigate();
  const [trialTimeRemaining, setTrialTimeRemaining] = useState(TRIAL_DURATION_SECONDS);
  const [lastSessionData, setLastSessionData] = useState(null);
  const [customWords, setCustomWords] = useState([]);
  const [customWord, setCustomWord] = useState('');

  const {
    isListening,
    transcript,
    fillerCounts,
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
      const sessionData = { transcript, fillerCounts, duration: TRIAL_DURATION_SECONDS * 1000 };
      setLastSessionData(sessionData);
      navigate('/analytics', { state: { sessionData } });
    }
    return () => clearInterval(timer);
  }, [isListening, trialTimeRemaining, stopListening, navigate, transcript, fillerCounts]);

  const handleStartSession = useCallback(() => {
    reset();
    setLastSessionData(null);
    setTrialTimeRemaining(TRIAL_DURATION_SECONDS);
    startListening();
  }, [reset, startListening]);

  const handleEndSession = useCallback(() => {
    stopListening();
    const sessionData = {
      transcript,
      fillerCounts,
      duration: TRIAL_DURATION_SECONDS - trialTimeRemaining,
    };
    setLastSessionData(sessionData);
    navigate('/analytics', { state: { sessionData } });
  }, [stopListening, transcript, fillerCounts, trialTimeRemaining, navigate]);

  const totalFillerWords = Object.values(fillerCounts).reduce((sum, count) => sum + count, 0);

  return (
    <>
      <SessionControl
        isRecording={isListening}
        onStart={handleStartSession}
        onEnd={handleEndSession}
        sessionDuration={TRIAL_DURATION_SECONDS - trialTimeRemaining}
      />
      <RecordingStatus
        isRecording={isListening}
        totalFillerWords={totalFillerWords}
      />
      <FillerWordCounters
        fillerCounts={fillerCounts}
        customWords={customWords}
        customWord={customWord}
        setCustomWord={setCustomWord}
        onAddCustomWord={handleAddCustomWord}
      />
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <InfoCard title="Privacy First">
          All processing happens on your device using browser APIs. Your speech never leaves your device.
        </InfoCard>
        <InfoCard title="Real-time Feedback">
          Get instant feedback on your speech patterns to improve your communication skills.
        </InfoCard>
      </div>
    </>
  );
};
