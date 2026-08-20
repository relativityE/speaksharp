import { describe, it, expect } from 'vitest';

/**
 * #1314 Cloud/Native cleanup — executable-surface guard (slice 1).
 *
 * OWNS the retired STT runtime identifiers so they cannot silently return after removal. This
 * slice ships the detector + its five defect-class mutants (fixture-driven, green now). The
 * LIVE repository-tree assertion is wired in the final narrowing slice, once Cloud + Native
 * removal is complete and the tree is clean — so each intermediate slice stays green.
 *
 * The guard targets SPECIFIC retired executable identifiers; it must never flag legitimate
 * Private STT, Gemini, Supabase/Vercel, or browser/CDP delivery code (e.g. MockPrivateWhisper,
 * generic "browser" words). The forbidden literals live here as data and are never logged.
 */

export interface RetiredPattern {
  id: string;
  re: RegExp;
  reason: string;
}

// Retired Cloud (AssemblyAI) + Native/Web-Speech executable identifiers.
export const RETIRED_STT_PATTERNS: readonly RetiredPattern[] = [
  { id: 'cloud-provider-import', re: /\b(CloudAssemblyAI|AssemblyAICloudProvider)\b/, reason: 'retired Cloud/AssemblyAI provider' },
  { id: 'assemblyai-token', re: /assemblyai-token|ASSEMBLYAI_TOKEN_ENDPOINT/i, reason: 'retired AssemblyAI token function/config consumer' },
  { id: 'web-speech-constructor', re: /new\s+(?:window\.)?(?:webkit)?SpeechRecognition\b/, reason: 'retired Web-Speech constructor' },
  { id: 'native-mode-class', re: /\bNativeBrowser\b/, reason: 'retired Native/Web-Speech STT mode' },
  { id: 'retired-mode-branch', re: /case\s+['"](?:cloud|native)['"]\s*:/, reason: 'retired native/cloud factory mode branch' },
  { id: 'retired-live-surface', re: /benchmark-native\.live\.spec|browser-webspeech-evidence|analytics-live-native-probe|manual-native-chrome-proof/, reason: 'retired native/cloud live spec or script' },
];

/** Return every retired-identifier hit in the given source files. */
export function scanForRetiredSurface(
  files: ReadonlyArray<{ path: string; content: string }>,
): Array<{ path: string; id: string; reason: string }> {
  const hits: Array<{ path: string; id: string; reason: string }> = [];
  for (const { path, content } of files) {
    for (const p of RETIRED_STT_PATTERNS) {
      if (p.re.test(content)) hits.push({ path, id: p.id, reason: p.reason });
    }
  }
  return hits;
}

describe('#1314 retired-STT executable-surface guard', () => {
  it('passes clean Private-only source (no retired identifiers)', () => {
    const clean = [
      { path: 'EngineFactory.ts', content: "import PrivateWhisper from './modes/PrivateWhisper';\nif (mode === 'private') engine = new PrivateWhisper(options);" },
      { path: 'e2e-bridge.ts', content: 'class MockPrivateWhisper {}\nwindow.MockPrivateWhisper = MockPrivateWhisper;' },
      { path: 'suggestions.ts', content: 'const gemini = callGemini(prompt); // Gemini AI suggestions retained' },
      { path: 'browser-delivery.ts', content: 'await page.goto(url); // browser/CDP delivery retained' },
    ];
    expect(scanForRetiredSurface(clean)).toEqual([]);
  });

  // The five defect-class mutants: each re-introduces a retired identifier and MUST be detected.
  const mutants: Array<{ id: string; content: string }> = [
    { id: 'cloud-provider-import', content: "import CloudAssemblyAI from './modes/CloudAssemblyAI';" },
    { id: 'assemblyai-token', content: "const url = CONFIG.ASSEMBLYAI_TOKEN_ENDPOINT; // fetch assemblyai-token" },
    { id: 'web-speech-constructor', content: 'const rec = new webkitSpeechRecognition();' },
    { id: 'retired-mode-branch', content: "switch (mode) { case 'cloud': engine = makeCloud(); break; }" },
    { id: 'retired-live-surface', content: "import './benchmark-native.live.spec';" },
  ];
  it.each(mutants)('rejects re-added retired surface: $id', ({ id, content }) => {
    const hits = scanForRetiredSurface([{ path: `mutant-${id}.ts`, content }]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.id === id)).toBe(true);
  });

  it('does not flag the retired Native STT mode as browser delivery (NativeBrowser vs browser)', () => {
    // "browser" delivery words are fine; only the NativeBrowser STT class is retired.
    expect(scanForRetiredSurface([{ path: 'x.ts', content: 'const useBrowser = true; // browser delivery' }])).toEqual([]);
    expect(scanForRetiredSurface([{ path: 'y.ts', content: 'new NativeBrowser(options)' }]).length).toBe(1);
  });
});
