/**
 * Phase 2 SANDBOX palette sheet — "Confident Momentum" design reference (QA / design-review only).
 * Shows every semantic token, status badges on white + ivory, the button hierarchy with states,
 * and the typography scale. Sandbox-local; not part of the product frame.
 */

import React from 'react';
import { PrimaryButton, SecondaryButton, GhostButton, StatusChip } from './ui';

const TOKENS: { name: string; varName: string; hex: string; onDark?: boolean }[] = [
  { name: 'Hero navy', varName: '--ss-hero', hex: '#0B1530', onDark: true },
  { name: 'Hero secondary', varName: '--ss-hero-secondary', hex: '#1E3473', onDark: true },
  { name: 'Canvas (ivory)', varName: '--ss-canvas', hex: '#F8F7F3' },
  { name: 'Surface', varName: '--ss-surface', hex: '#FFFFFF' },
  { name: 'Primary (cobalt)', varName: '--ss-primary', hex: '#3155D9', onDark: true },
  { name: 'Primary hover', varName: '--ss-primary-hover', hex: '#243FA8', onDark: true },
  { name: 'Listening (teal)', varName: '--ss-listening', hex: '#0D9488', onDark: true },
  { name: 'Aqua', varName: '--ss-aqua', hex: '#2DD4BF' },
  { name: 'Ink', varName: '--ss-text', hex: '#0F172A', onDark: true },
  { name: 'Secondary text', varName: '--ss-text-secondary', hex: '#475569', onDark: true },
  { name: 'Border', varName: '--ss-border', hex: '#D7DEE8' },
  { name: 'Neutral', varName: '--ss-neutral', hex: '#64748B', onDark: true },
  { name: 'Success (emerald)', varName: '--ss-success', hex: '#087A55', onDark: true },
  { name: 'Partial (amber)', varName: '--ss-partial', hex: '#B96508', onDark: true },
  { name: 'Setback (red)', varName: '--ss-setback', hex: '#B42318', onDark: true },
  { name: 'Focus ring', varName: '--ss-focus', hex: '#38BDF8' },
];

function Swatch({ name, hex, onDark }: { name: string; hex: string; onDark?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-[color:var(--ss-border)]">
      <div className="grid h-12 place-items-center text-xs font-semibold" style={{ background: hex, color: onDark ? '#fff' : '#0F172A' }}>{hex}</div>
      <div className="bg-white px-2 py-1 text-[11px] text-[color:var(--ss-text-secondary)]">{name}</div>
    </div>
  );
}

export function PaletteSheet() {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-[color:var(--ss-border)]">
      <h3 className="text-lg font-semibold text-[color:var(--ss-text)]">Confident Momentum — palette</h3>
      <p className="mt-1 text-sm text-[color:var(--ss-text-secondary)]">~60% ivory/white · ~25% navy/ink · ~10% cobalt/teal · ~5% status. Cobalt + teal = action/brand; amber/emerald/slate/red = state meaning only.</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TOKENS.map((t) => <Swatch key={t.varName} name={t.name} hex={t.hex} onDark={t.onDark} />)}
      </div>

      <h4 className="mt-6 text-sm font-semibold text-[color:var(--ss-text)]">Status badges (white surface)</h4>
      <div className="mt-2 flex flex-wrap gap-2 rounded-xl bg-white p-3 ring-1 ring-[color:var(--ss-border)]">
        <StatusChip state="not_addressed" /><StatusChip state="partial" /><StatusChip state="covered" /><StatusChip state="recovered" />
      </div>
      <h4 className="mt-3 text-sm font-semibold text-[color:var(--ss-text)]">Status badges (ivory surface)</h4>
      <div className="mt-2 flex flex-wrap gap-2 rounded-xl bg-[color:var(--ss-canvas)] p-3 ring-1 ring-[color:var(--ss-border)]">
        <StatusChip state="not_addressed" /><StatusChip state="partial" /><StatusChip state="covered" /><StatusChip state="recovered" />
      </div>

      <h4 className="mt-6 text-sm font-semibold text-[color:var(--ss-text)]">Button hierarchy</h4>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <PrimaryButton>Primary action</PrimaryButton>
        <SecondaryButton>Secondary</SecondaryButton>
        <GhostButton>Ghost</GhostButton>
        <PrimaryButton disabled>Disabled</PrimaryButton>
      </div>
      <p className="mt-1 text-xs text-[color:var(--ss-neutral)]">Tab to a control to see the sky-blue focus outline. Hover primary → deeper cobalt.</p>

      <h4 className="mt-6 text-sm font-semibold text-[color:var(--ss-text)]">Typography</h4>
      <div className="mt-2 space-y-1">
        <p className="text-2xl font-semibold text-[color:var(--ss-text)]">Heading — ink 2xl semibold</p>
        <p className="text-[15px] text-[color:var(--ss-text)]">Body — ink 15px</p>
        <p className="text-sm text-[color:var(--ss-text-secondary)]">Secondary — slate 14px</p>
        <p className="text-xs text-[color:var(--ss-neutral)]">Muted — neutral 12px</p>
      </div>
    </div>
  );
}
