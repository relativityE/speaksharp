import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { PostHogProvider } from 'posthog-js/react'
import { initPostHog } from './lib/posthog.js'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import * as Sentry from '@sentry/react';
import { ErrorPage } from './pages/ErrorPage';


// Initialize PostHog
initPostHog();

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  environment: import.meta.env.MODE,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1, // This records 10% of sessions.
  replaysOnErrorSampleRate: 1.0, // This records 100% of sessions that have an error.
  sendDefaultPii: true,
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <PostHogProvider>
        <AuthProvider>
          <Elements stripe={stripePromise}>
            {/* The Sentry.ErrorBoundary wraps the entire App to catch all errors */}
            <Sentry.ErrorBoundary fallback={<ErrorPage />}>
              <App />
            </Sentry.ErrorBoundary>
          </Elements>
        </AuthProvider>
      </PostHogProvider>
    </BrowserRouter>
  </StrictMode>,
)
