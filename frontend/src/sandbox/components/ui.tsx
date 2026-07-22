/**
 * Phase 2 SANDBOX premium primitives (self-contained; Tailwind + shared reset only, no app providers).
 * Icons: lucide-react (pure SVG). Agenda status uses glyph + text + color — never color alone.
 */

import React from 'react';
import { T, type AgendaVisualState } from '../theme';

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return <button className={`${T.primaryBtn} ${className}`} {...rest} />;
}
export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return <button className={`${T.secondaryBtn} ${className}`} {...rest} />;
}
export function GhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return <button className={`${T.ghostBtn} ${className}`} {...rest} />;
}

/** Warm-white content card sitting on the navy frame. */
export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl ${T.surface} p-6 shadow-xl shadow-slate-900/10 sm:p-8 ${className}`}>{children}</div>;
}

const GLYPH: Record<AgendaVisualState, { glyph: string; label: string; cls: string }> = {
  covered: { glyph: '●', label: 'Covered', cls: T.covered.dot },
  partial: { glyph: '◐', label: 'Partly addressed', cls: T.partial.dot },
  not_addressed: { glyph: '○', label: 'Not yet addressed', cls: T.notAddressed.dot },
  recovered: { glyph: '✦', label: 'Recovered after guidance', cls: T.recovered.dot },
};

/** An agenda status dot (glyph) + its accessible label text. */
export function AgendaDot({ state, className = '' }: { state: AgendaVisualState; className?: string }) {
  const g = GLYPH[state];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span aria-hidden className={`text-lg leading-none ${g.cls}`}>{g.glyph}</span>
      <span className="sr-only">{g.label}</span>
    </span>
  );
}

export function StatusChip({ state }: { state: AgendaVisualState }) {
  const g = GLYPH[state];
  const chip =
    state === 'covered' ? T.covered.chip : state === 'partial' ? T.partial.chip : state === 'recovered' ? T.recovered.chip : T.notAddressed.chip;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${chip}`}>
      <span aria-hidden className={g.cls}>{g.glyph}</span>
      {g.label}
    </span>
  );
}

/** Subtle listening indicator; respects reduced-motion. */
export function ListeningPulse({ label = 'Listening' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-300">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-400" />
      </span>
      {label}
    </span>
  );
}

export type RecordStatus = 'ready' | 'listening' | 'paused' | 'processing';

/** Listening visualization — a small equalizer that animates only while listening (reduced-motion safe). */
export function Equalizer({ active }: { active: boolean }) {
  const bars = [0, 1, 2, 3, 4];
  return (
    <span aria-hidden className="flex h-6 items-end gap-1">
      {bars.map((b) => (
        <span
          key={b}
          className={`w-1 rounded-full ${active ? 'ss-eq-bar bg-teal-400' : 'bg-slate-600'}`}
          style={{ height: '100%', animationDelay: `${b * 0.12}s`, transform: active ? undefined : 'scaleY(0.4)' }}
        />
      ))}
    </span>
  );
}

/** State-aware recording indicator (Ready / Listening / Paused / Processing) — text + icon + color. */
export function RecordingIndicator({ status, seconds }: { status: RecordStatus; seconds?: number }) {
  const label = status === 'ready' ? 'Ready' : status === 'listening' ? 'Listening' : status === 'paused' ? 'Paused' : 'Finalizing';
  const dot = status === 'listening' ? 'bg-teal-400' : status === 'paused' ? 'bg-amber-400' : status === 'processing' ? 'bg-indigo-400' : 'bg-slate-400';
  const mm = seconds !== undefined ? String(Math.floor(seconds / 60)) : null;
  const ss = seconds !== undefined ? String(seconds % 60).padStart(2, '0') : null;
  return (
    <span className="inline-flex items-center gap-3">
      <span className="inline-flex items-center gap-2 rounded-full bg-slate-800/70 px-3 py-1.5 text-sm font-semibold text-slate-100 ring-1 ring-slate-700">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      <Equalizer active={status === 'listening'} />
      {mm !== null ? <span className="text-sm font-medium tabular-nums text-slate-400">{mm}:{ss}</span> : null}
    </span>
  );
}

/** Progressive-disclosure block — the numbers/formulas live here, off the primary screen. */
export function Disclosure({ summary, children, onOpen }: { summary: string; children: React.ReactNode; onOpen?: () => void }) {
  return (
    <details
      className="group mt-4 rounded-xl border border-slate-200 bg-white/70"
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) onOpen?.(); }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
        <span>{summary}</span>
        <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-slate-200 px-4 py-4 text-sm text-slate-600">{children}</div>
    </details>
  );
}

/** Journey step indicator (Prepare → Rehearse → Summary). */
export function JourneySteps({ current }: { current: 'prepare' | 'rehearse' | 'finish' }) {
  const steps: { key: typeof current; label: string }[] = [
    { key: 'prepare', label: 'Prepare' },
    { key: 'rehearse', label: 'Rehearse' },
    { key: 'finish', label: 'Summary' },
  ];
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-xs font-medium">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className={`inline-flex h-6 items-center rounded-full px-2.5 ${i <= idx ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'}`}>{s.label}</span>
          {i < steps.length - 1 ? <span aria-hidden className={i < idx ? 'text-indigo-400' : 'text-slate-600'}>→</span> : null}
        </li>
      ))}
    </ol>
  );
}
