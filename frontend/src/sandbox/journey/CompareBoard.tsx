/**
 * Phase 2 SANDBOX — landing theme-comparison board (localhost review only, ?compare=1).
 *
 * Renders the THREE candidate landing themes (A/B/C) side-by-side so the visual treatment can be
 * compared on identical content and state. Each panel is a same-origin <iframe> of the real themed
 * landing (`sandbox.html?theme=<id>`), so every theme is the genuine render at a true desktop or phone
 * width — not a responsive layout squeezed into a narrow column. `?compare=1&mode=mobile` shows the
 * 375px stacked layout of each theme; default/desktop shows the 1280px two-column layout.
 *
 * This board is a REVIEW SURFACE, not a product control and not a selection. No theme is chosen here.
 */

import React from 'react';
import type { LandingTheme } from './LandingScreen';

const THEMES: { id: LandingTheme; name: string; tagline: string }[] = [
  { id: 'a', name: 'Theme A — Vibrant Confidence', tagline: 'Lavender → aqua → peach hero · teal Session · violet Rehearsal' },
  { id: 'b', name: 'Theme B — Ocean Energy', tagline: 'Sky → aqua → sand hero · teal Session · ocean-blue Rehearsal' },
  { id: 'c', name: 'Theme C — Warm Premium', tagline: 'Lilac → mint → cream hero · emerald Session · plum Rehearsal' },
];

const compareMode = (): 'desktop' | 'mobile' => {
  try { return new URLSearchParams(window.location.search).get('mode') === 'mobile' ? 'mobile' : 'desktop'; } catch { return 'desktop'; }
};

export function CompareBoard() {
  const mode = compareMode();
  // Faithful logical viewport per frame; `zoom` (Chromium) shrinks the whole box so 3 fit side-by-side.
  const frame = mode === 'mobile' ? { w: 390, h: 1480, zoom: 0.82 } : { w: 1280, h: 1000, zoom: 0.4 };

  return (
    <div className="min-h-screen bg-slate-100 font-sans antialiased">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Landing theme comparison — decision evidence</h1>
        <p className="mt-1 text-sm text-slate-600">
          The three candidates reviewed on the same frozen two-column layout and content ({mode} render). <span className="font-semibold">Theme A — Vibrant Confidence was selected</span> and is now the sandbox default; B and C are retained here only as the A/B/C decision record (?compare=1).
        </p>
      </header>

      <main id="main-content" className="flex flex-nowrap items-start gap-5 overflow-x-auto p-6">
        {THEMES.map((t) => (
          <figure key={t.id} className="shrink-0 overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-200">
            <figcaption className="border-b border-slate-200 px-4 py-2.5">
              <div className="text-sm font-semibold text-slate-900">{t.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">{t.tagline}</div>
            </figcaption>
            <div style={{ width: frame.w * frame.zoom, height: frame.h * frame.zoom }} className="overflow-hidden">
              <iframe
                title={t.name}
                src={`sandbox.html?theme=${t.id}`}
                width={frame.w}
                height={frame.h}
                loading="eager"
                style={{ border: 0, zoom: frame.zoom }}
              />
            </div>
          </figure>
        ))}
      </main>
    </div>
  );
}
