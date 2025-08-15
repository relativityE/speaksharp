import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import * as Sentry from "@sentry/react";

// Initialize PostHog
if (import.meta.env.VITE_POSTHOG_KEY && import.meta.env.VITE_POSTHOG_HOST) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST,
    capture_exceptions: true,
    debug: import.meta.env.MODE === 'development',
  })
}


const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  environment: import.meta.env.MODE,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1, // This records 10% of sessions.
  replaysOnErrorSampleRate: 1.0, // This records 100% of sessions that have an error.
  sendDefaultPii: true,
})

const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);

root.render(
  <StrictMode>
    <BrowserRouter>
      <PostHogProvider client={posthog}>
        <AuthProvider>
          <Elements stripe={stripePromise}>
            {/* The Sentry.ErrorBoundary wraps the entire App to catch all errors */}
            <Sentry.ErrorBoundary fallback={<div>An error has occurred. Please refresh the page.</div>}>
              <App />
            </Sentry.ErrorBoundary>
          </Elements>
        </AuthProvider>
      </PostHogProvider>
    </BrowserRouter>
  </StrictMode>
);
