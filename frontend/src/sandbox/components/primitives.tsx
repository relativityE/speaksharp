/**
 * Phase 2 SANDBOX-local presentational primitives.
 *
 * Deliberately self-contained (Tailwind + shared design tokens from index.css only) so the sandbox
 * imports NO application provider, store, or service. Icons come from lucide-react (pure SVG). These
 * mirror the look of the app's card/badge/progress without pulling in @/components/ui/*.
 */

import React from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-card text-card-foreground shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="border-b border-border px-5 py-4">
      <h3 className="text-base font-semibold leading-tight">{title}</h3>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

/** A metric progress bar. `pct` may be null (no %); negative clamps to 0 width but is labelled. */
export function ProgressBar({ pct, ariaLabel }: { pct: number | null; ariaLabel: string }) {
  const width = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct === null ? undefined : Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${width}%` }} />
    </div>
  );
}

export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  info: 'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-100 dark:border-sky-800',
  good: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800',
  warn: 'bg-amber-100 text-amber-950 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800',
  bad: 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-100 dark:border-rose-800',
};

/**
 * A status pill. Color is NEVER the only signal — an icon + text label always accompany it, per the
 * accessibility contract.
 */
export function StatePill({ tone, icon, children }: { tone: Tone; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses[tone]}`}>
      <span aria-hidden="true" className="inline-flex">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

/** A keyboard-accessible disclosure ("Show calculation") built on <details>. */
export function Disclosure({
  summary,
  children,
  onOpen,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  onOpen?: () => void;
}) {
  return (
    <details
      className="group mt-3 rounded-lg border border-border bg-background/50"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) onOpen?.();
      }}
    >
      <summary className="cursor-pointer list-none rounded-lg px-3 py-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="select-none">{summary}</span>
      </summary>
      <div className="border-t border-border px-3 py-3 text-sm text-muted-foreground">{children}</div>
    </details>
  );
}
