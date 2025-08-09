import React, { useState, useEffect, useCallback } from 'react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { SessionControl } from './components/SessionControl';
import { RecordingStatus } from './components/RecordingStatus';
import { FillerWordCounters } from './components/FillerWordCounters';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { ErrorDisplay } from './components/ErrorDisplay';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import './App.css';

function App() {
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [customWords, setCustomWords] = useState([]);
  const [newWord, setNewWord] = useState('');

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

  useEffect(() => {
    let timer;
    if (sessionActive) {
      timer = setInterval(() => {
        setSessionDuration(Date.now() - sessionStartTime);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [sessionActive, sessionStartTime]);

  const handleStartSession = useCallback(() => {
    reset();
    setSessionActive(true);
    setSessionStartTime(Date.now());
    setSessionDuration(0);
    startListening();
  }, [reset, startListening]);

  const handleStopSession = useCallback(() => {
    stopListening();
    setSessionActive(false);
  }, [stopListening]);

  const handleEndSession = useCallback(() => {
    stopListening();
    setSessionActive(false);
    // Analytics will be based on the final state of transcript and fillerCounts
  }, [stopListening]);

  const handleAddWord = () => {
    if (newWord && !customWords.includes(newWord.toLowerCase())) {
      setCustomWords([...customWords, newWord.toLowerCase()]);
      setNewWord('');
    }
  };

  if (!isSupported) {
    return <ErrorDisplay message="Speech recognition is not supported in this browser." />;
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>SayLess</h1>
        <p>Your personal speech coach</p>
      </header>
      <main>
        <SessionControl
          sessionActive={sessionActive}
          isListening={isListening}
          onStart={handleStartSession}
          onStop={handleStopSession}
          onEnd={handleEndSession}
        />
        <RecordingStatus
          isListening={isListening}
          sessionActive={sessionActive}
          sessionDuration={sessionDuration}
        />
        {error && <ErrorDisplay message={error} />}

        <div className="custom-word-input">
          <Input
            type="text"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="Add custom filler word"
            disabled={sessionActive}
          />
          <Button onClick={handleAddWord} disabled={sessionActive}>Add</Button>
        </div>

        {sessionActive || transcript ? (
          <div className="session-data">
            <FillerWordCounters counts={fillerCounts} />
            <div className="transcript-container">
              <h2>Transcript</h2>
              <p>{transcript}</p>
            </div>
          </div>
        ) : (
          <div className="placeholder-text">
            <p>Click "Start Session" to begin recording.</p>
          </div>
        )}

        {!sessionActive && transcript && (
           <AnalyticsDashboard
             transcript={transcript}
             fillerCounts={fillerCounts}
             duration={sessionDuration}
           />
        )}
      </main>
    </div>
  );
}

export default App;
