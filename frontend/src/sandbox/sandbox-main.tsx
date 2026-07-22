/**
 * Phase 2 SANDBOX standalone entry point — LOCALHOST DEVELOPMENT ONLY.
 *
 * This is a dedicated Vite entry, deliberately separate from src/main.tsx. It boots ONLY React +
 * the sandbox page + the shared stylesheet. It imports NONE of: main.tsx, App.tsx, AuthProvider,
 * PostHogProvider, Sentry, Supabase clients, Stripe, AssemblyAI, Gemini/AI clients, or any store /
 * service that creates an external side effect. There is no network I/O.
 *
 * Belt-and-suspenders guard: even though frontend/sandbox.html is not in the production build inputs
 * (so it can never be emitted), if this module is ever evaluated in a production build it renders a
 * plain "not found" notice instead of the sandbox — it never relies on a route/env flag alone.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import './sandbox.css';
import { ProgressRehearsalSandbox } from './ProgressRehearsalSandbox';

const rootEl = document.getElementById('sandbox-root');

if (import.meta.env.PROD) {
  // Development-only sandbox — never render in a production build.
  if (rootEl) rootEl.textContent = 'Not found.';
} else if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <ProgressRehearsalSandbox />
    </StrictMode>,
  );
}
