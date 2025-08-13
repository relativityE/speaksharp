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

// This part is for standalone rendering, which we might not need if we use a route.
// However, it's good practice to have it.
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<TestPage />);
}

// Export the component for use in the router
export default TestPage;
