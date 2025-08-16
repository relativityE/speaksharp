import React from 'react';
import { createRoot } from 'react-dom/client';
import { useSpeechRecognition } from '../../src/hooks/useSpeechRecognition';

function TestHarness() {
  const { transcript, isListening, startListening } = useSpeechRecognition({ mode: 'native' });

  return (
    <div>
      <div id="isListening">{String(isListening)}</div>
      <div id="transcript">{transcript}</div>
      <button id="startListening" onClick={startListening}>Start</button>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<TestHarness />);
