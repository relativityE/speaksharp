import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import * as Sentry from '@sentry/react'
import { PostHogProvider } from 'posthog-js/react'

const options = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  defaults: '2025-05-24',
  capture_exceptions: true, // Enables capturing exceptions using Error Tracking
  debug: import.meta.env.MODE === 'development',
}

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
    <PostHogProvider apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY} options={options}>
      <BrowserRouter>
        <AuthProvider>
          <Sentry.ErrorBoundary fallback={<div>An error has occurred. Please refresh the page.</div>}>
            <App />
          </Sentry.ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </PostHogProvider>
  </StrictMode>,
)
