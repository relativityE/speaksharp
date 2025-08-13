import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'

// --- Sentry Initialization Code ---
// This code initializes Sentry for the entire application.
import * as Sentry from '@sentry/react';

// --- Step 2: Initialize Sentry
// IMPORTANT: use the DSN copied from Sentry's website.
// It is recommended to use an environment variable for the DSN in a real project.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    // This is the core browser tracing integration for a simpler setup.
    Sentry.browserTracingIntegration(),
  ],

  // Set the environment (e.g., 'development').
  // The 'import.meta.env.MODE' variable is a Vite feature that automatically gets the mode.
  environment: import.meta.env.MODE,

  // This enables performance monitoring.
  // For a solo project, tracing 100% of transactions is fine.
  tracesSampleRate: 1.0,

  // This enables session tracking.
  replaysSessionSampleRate: 0.1, // This records 10% of sessions.
  replaysOnErrorSampleRate: 1.0, // This records 100% of sessions that have an error.

  // Setting this option to true will send default PII data to Sentry.
  sendDefaultPii: true
});

// --- Step 3: Use Sentry.ErrorBoundary to wrap your app
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {/* The Sentry.ErrorBoundary wraps the entire App to catch all errors */}
        <Sentry.ErrorBoundary fallback={<div>An error has occurred. Please refresh the page.</div>}>
          <App />
        </Sentry.ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
