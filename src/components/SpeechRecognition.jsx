import React from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

export function SpeechRecognition({ mode }) {
  const { isListening, transcript, startListening, stopListening, error } = useSpeechRecognition({ mode });

  return (
    <div>
      {error && <p>Error: {error.message}</p>}
      <p>Transcript: {transcript}</p>
      <p>Listening: {isListening.toString()}</p>
      <button onClick={startListening}>Start</button>
      <button onClick={stopListening}>Stop</button>
    </div>
  );
}

export default SpeechRecognition;
