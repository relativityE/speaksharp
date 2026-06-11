import React, { useEffect } from 'react';
import type { DevEnvironmentStatus } from '@/lib/devEnvironmentGuard';

interface InvalidEnvironmentPageProps {
  status: DevEnvironmentStatus;
}

export const InvalidEnvironmentPage: React.FC<InvalidEnvironmentPageProps> = ({ status }) => {
  useEffect(() => {
    requestAnimationFrame(() => {
      document.body.classList.add('app-loaded');
    });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="max-w-2xl rounded-xl border border-destructive/30 bg-white p-6 shadow-[var(--shadow-card-primary)]">
        <p className="text-xs font-extrabold uppercase tracking-wider text-destructive">
          Invalid local environment
        </p>
        <h1 className="mt-2 text-3xl font-extrabold text-foreground">
          This app was blocked before manual testing.
        </h1>
        <p className="mt-3 text-base font-semibold leading-relaxed text-foreground/75">
          {status.message || 'SpeakSharp detected a mixed local mode, port, or auth configuration.'}
        </p>
        <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4 text-sm font-semibold text-foreground/80">
          <p>Use <code className="rounded bg-white px-1.5 py-0.5 font-mono">pnpm dev</code> for real manual testing on port 5174.</p>
          <p className="mt-2">Use <code className="rounded bg-white px-1.5 py-0.5 font-mono">pnpm dev:test</code> only for mocked E2E diagnostics on port 5173.</p>
        </div>
        <p className="mt-4 text-sm font-medium text-foreground/60">
          A real-looking app must never boot with fake credentials.
        </p>
      </section>
    </main>
  );
};

export default InvalidEnvironmentPage;
