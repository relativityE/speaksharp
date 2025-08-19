// playwright-tests/harness/index.tsx - Lightweight Version
import React, { useState, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

// Lazy load heavy components
const SpeechRecognitionComponent = React.lazy(() =>
  import('../../src/components/SpeechRecognition').then(module => ({
    default: module.SpeechRecognition || module.default
  }))
);

function TestHarness() {
  const [mode, setMode] = useState('cloud');
  const [isLoading, setIsLoading] = useState(false);

  const switchToNative = async () => {
    setIsLoading(true);
    setMode('native');
    // Small delay to ensure state update
    setTimeout(() => setIsLoading(false), 100);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Speech Recognition Test</h1>

      <div style={{ marginBottom: '20px' }}>
        <p>Current Mode: <strong>{mode}</strong></p>

        <button
          onClick={switchToNative}
          disabled={isLoading}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            marginRight: '10px'
          }}
        >
          {isLoading ? 'Switching...' : 'Switch to Native'}
        </button>
      </div>

      <div style={{ border: '1px solid #ccc', padding: '20px' }}>
        <Suspense fallback={<div>Loading component...</div>}>
          <SpeechRecognitionComponent mode={mode} />
        </Suspense>
      </div>
    </div>
  );
}

// Optimized initialization
const container = document.getElementById('root');
if (!container) {
  const newContainer = document.createElement('div');
  newContainer.id = 'root';
  document.body.appendChild(newContainer);
}

const root = createRoot(container || document.getElementById('root'));
root.render(<TestHarness />);

// Signal to Playwright that the app is ready
window.addEventListener('load', () => {
  document.body.setAttribute('data-testready', 'true');
});
