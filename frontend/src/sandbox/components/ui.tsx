/**
 * Phase 2 SANDBOX premium primitives (self-contained; "Confident Momentum" tokens).
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

/** White content card on the ivory canvas — grouped by surface contrast + soft shadow, few borders. */
export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-3xl bg-white p-6 shadow-lg shadow-slate-900/[0.06] ring-1 ring-[color:var(--ss-border)] sm:p-8 ${className}`}>{children}</div>;
}

const GLYPH: Record<AgendaVisualState, { glyph: string; label: string; dot: string; chip: string }> = {
  covered: { glyph: '●', label: 'Covered', dot: T.covered.dot, chip: T.covered.chip },
  partial: { glyph: '◐', label: 'Partly addressed', dot: T.partial.dot, chip: T.partial.chip },
  not_addressed: { glyph: '○', label: 'Not yet addressed', dot: T.notAddressed.dot, chip: T.notAddressed.chip },
  recovered: { glyph: '✦', label: 'Recovered after guidance', dot: T.recovered.dot, chip: T.recovered.chip },
};

/** An agenda status dot (glyph) + accessible label. */
export function AgendaDot({ state, className = '' }: { state: AgendaVisualState; className?: string }) {
  const g = GLYPH[state];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span aria-hidden className={`text-lg leading-none ${g.dot}`}>{g.glyph}</span>
      <span className="sr-only">{g.label}</span>
    </span>
  );
}

export function StatusChip({ state }: { state: AgendaVisualState }) {
  const g = GLYPH[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${g.chip}`}>
      <span aria-hidden className={g.dot}>{g.glyph}</span>
      {g.label}
    </span>
  );
}

export type RecordStatus = 'ready' | 'listening' | 'paused' | 'processing';

/** Listening visualization — a teal equalizer that animates only while listening (reduced-motion safe). */
export function Equalizer({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="flex h-6 items-end gap-1">
      {[0, 1, 2, 3, 4].map((b) => (
        <span
          key={b}
          className={`w-1 rounded-full ${active ? 'ss-eq-bar' : ''}`}
          style={{ height: '100%', background: active ? 'var(--ss-listening)' : 'var(--ss-border)', animationDelay: `${b * 0.12}s`, transform: active ? undefined : 'scaleY(0.4)' }}
        />
      ))}
    </span>
  );
}

/** State-aware recording indicator (Ready / Listening / Paused / Processing) — text + icon + color, on a light surface. */
export function RecordingIndicator({ status, seconds }: { status: RecordStatus; seconds?: number }) {
  const label = status === 'ready' ? 'Ready' : status === 'listening' ? 'Listening' : status === 'paused' ? 'Paused' : 'Finalizing';
  const dot = status === 'listening' ? 'var(--ss-listening)' : status === 'paused' ? 'var(--ss-partial)' : status === 'processing' ? 'var(--ss-primary)' : 'var(--ss-neutral)';
  const mm = seconds !== undefined ? String(Math.floor(seconds / 60)) : null;
  const ss = seconds !== undefined ? String(seconds % 60).padStart(2, '0') : null;
  return (
    <span className="inline-flex items-center gap-3">
      <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-[color:var(--ss-text)] ring-1 ring-[color:var(--ss-border)]">
        {status === 'listening' ? (
          <span className="relative flex h-2.5 w-2.5"><span className="ss-breathe absolute inline-flex h-full w-full rounded-full" style={{ background: dot }} /><span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: dot }} /></span>
        ) : (
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
        )}
        {label}
      </span>
      <Equalizer active={status === 'listening'} />
      {mm !== null ? <span className="text-sm font-medium tabular-nums text-[color:var(--ss-neutral)]">{mm}:{ss}</span> : null}
    </span>
  );
}

/** Progressive-disclosure block — numbers/formulas live here, off the primary screen. */
export function Disclosure({ summary, children, onOpen }: { summary: string; children: React.ReactNode; onOpen?: () => void }) {
  return (
    <details
      className="group mt-4 rounded-xl bg-[color:var(--ss-canvas)] ring-1 ring-[color:var(--ss-border)]"
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) onOpen?.(); }}
    >
      <summary className="ss-ring flex cursor-pointer list-none items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold text-[color:var(--ss-text-secondary)]">
        <span>{summary}</span>
        <span aria-hidden className="text-[color:var(--ss-neutral)] transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-[color:var(--ss-border)] px-4 py-4 text-sm text-[color:var(--ss-text-secondary)]">{children}</div>
    </details>
  );
}

/** Journey step indicator (Prepare → Rehearse → Summary), shown on the navy header. */
export function JourneySteps({ current }: { current: 'prepare' | 'rehearse' | 'finish' }) {
  const steps: { key: typeof current; label: string }[] = [
    { key: 'prepare', label: 'Prepare' },
    { key: 'rehearse', label: 'Rehearse' },
    { key: 'finish', label: 'Review' },
  ];
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-xs font-medium">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className={`inline-flex h-6 items-center rounded-full px-2.5 ${i <= idx ? 'text-white' : 'text-slate-300'}`} style={{ background: i <= idx ? 'var(--ss-primary)' : 'rgba(255,255,255,0.08)' }}>{s.label}</span>
          {i < steps.length - 1 ? <span aria-hidden style={{ color: i < idx ? 'var(--ss-aqua)' : 'rgba(255,255,255,0.3)' }}>→</span> : null}
        </li>
      ))}
    </ol>
  );
}
