import React from 'react';
import { createRoot } from 'react-dom/client';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

function TestPage() {
  const { transcript, isListening, startListening } = useSpeechRecognition();

  return (
    <div>
      <div id="isListening">{String(isListening)}</div>
      <div id="transcript">{transcript}</div>
      <button id="startListening" onClick={startListening}>Start</button>
    </div>
  );
}

// Export the component for use in the router
export default TestPage;
