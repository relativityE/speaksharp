import { describe, it, expect, afterEach, vi } from 'vitest';

vi.unmock('../nativeTranscriptFormatter');
vi.unmock('../nativeDeterministicCleanup');
vi.unmock('../nativePunctuationRestore');

import {
  restoreNativePunctuation,
  isNativePunctuationRestoreEnabled,
  NATIVE_PUNCTUATION_RESTORE_VERSION,
} from '../nativePunctuationRestore';
import {
  registerNativeProductionFormatter,
  assertNotPrivateMode,
} from '../nativeDeterministicCleanup';
import {
  formatNativeTranscript,
  registerNativeTranscriptFormatter,
  isWordPreserving,
  transcriptWordSequence,
  getNativeFormatterTelemetry,
  FORMATTER_LATENCY_BUDGET_MS,
} from '../nativeTranscriptFormatter';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

afterEach(() => {
  registerNativeTranscriptFormatter(null);
});

// A realistic run-on Native (Web Speech) transcript: near-punctuation-free, some
// interior segment-start capitals + a proper noun, fillers present.
const RUN_ON =
  'so today i practiced my presentation about the quarterly results um i think it went well ' +
  'but i need to work on my pacing you know i talked to Sarah about the feedback ' +
  'Then we reviewed the slides one more time before the meeting';

// Reviewer STT corpus lives at repo-root tests/fixtures/speeches. Resolve it robustly
// whether the vitest cwd is the repo root or the frontend project (jsdom-safe — no `new URL`).
function findSpeechesDir(): string {
  const candidates = [
    resolve(process.cwd(), 'tests/fixtures/speeches'),
    resolve(process.cwd(), '../tests/fixtures/speeches'),
  ];
  for (const c of candidates) {
    try { if (statSync(c).isDirectory()) return c; } catch { /* try next candidate */ }
  }
  throw new Error(`reviewer corpus not found; looked in: ${candidates.join(', ')}`);
}
const SPEECHES_DIR = findSpeechesDir();
interface CorpusItem { name: string; transcript: string; fillerWords: string[] }
function loadReviewerCorpus(): CorpusItem[] {
  return readdirSync(SPEECHES_DIR)
    .filter((d) => statSync(join(SPEECHES_DIR, d)).isDirectory())
    .map((d) => ({
      name: d,
      transcript: readFileSync(join(SPEECHES_DIR, d, 'transcript.txt'), 'utf-8'),
      fillerWords: (JSON.parse(readFileSync(join(SPEECHES_DIR, d, 'metadata.json'), 'utf-8')).fillerWords ?? []) as string[],
    }));
}
const REVIEWER_CORPUS = loadReviewerCorpus();

// Count sentence-terminal marks that are NOT the trailing one. The restorer must never
// introduce an internal boundary (no invented periods → no false proper-noun splits),
// so this count is identical in and out.
function internalStops(s: string): number {
  const body = s.replace(/[\s.!?"')\]]+$/, '');
  return (body.match(/[.!?]/g) || []).length;
}

describe('restoreNativePunctuation — safe readability (no invented breaks)', () => {
  it('applies first-cap, isolated "i" -> "I", and a terminal period', () => {
    const out = restoreNativePunctuation(RUN_ON);
    expect(out[0]).toBe('S');           // first-letter capitalized
    expect(out).toMatch(/\bI\b/);        // isolated "i" uppercased
    expect(out).not.toMatch(/\bi\b/);    // no lowercase standalone "i" remains
    expect(out.endsWith('.')).toBe(true);
    // No internal sentence breaks invented — only the terminal period.
    expect((out.match(/\./g) || []).length).toBe(1);
  });

  it('capitalizes the first word + standalone "i" but does not split before an interior capital', () => {
    expect(restoreNativePunctuation('i finished the first section Then we moved on to questions'))
      .toBe('I finished the first section Then we moved on to questions.');
  });

  it('does NOT invent breaks at ambiguous lowercase words (well/so/and/then)', () => {
    expect(restoreNativePunctuation('i really wanted to finish the whole thing so we kept going'))
      .toBe('I really wanted to finish the whole thing so we kept going.');
    expect(restoreNativePunctuation('i think it went well but i need to work on it'))
      .toBe('I think it went well but I need to work on it.');
  });

  it('does NOT invent a break in a long run-on that has no boundary signal', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i + 1}`).join(' ');
    const out = restoreNativePunctuation(words);
    expect((out.match(/\./g) || []).length).toBe(1); // only the terminal period
  });
});

// PO-required regression: an interior Title-case word (proper noun OR segment start)
// must never produce a false sentence boundary. Reduced scope = no internal breaks.
describe('restoreNativePunctuation — proper-noun / segment-start false-split regression', () => {
  const cases: Array<[string, string]> = [
    ['yesterday morning i called Sarah about the plan', 'Yesterday morning I called Sarah about the plan.'],
    ['i talked to John and Sarah about the slides', 'I talked to John and Sarah about the slides.'],
    ['we met with Sarah Then we reviewed the notes', 'We met with Sarah Then we reviewed the notes.'],
    ['i talked to Sarah about the feedback Then we reviewed the slides', 'I talked to Sarah about the feedback Then we reviewed the slides.'],
  ];
  it.each(cases)('no false boundary: %s', (input, expected) => {
    const out = restoreNativePunctuation(input);
    expect(out).toBe(expected);
    expect((out.match(/\./g) || []).length).toBe(1); // exactly the terminal period
    expect(out).not.toMatch(/\.\s+Sarah/);           // never "... . Sarah"
    expect(out).not.toMatch(/and\.\s/);              // never "... and. ..."
  });
});

describe('restoreNativePunctuation — word preservation (safety contract)', () => {
  const inputs = [
    RUN_ON,
    'um so like you know basically i was literally just talking',
    'i talked to John and Sarah about the New York trip',
    '',
    '7 seconds later we started again',
  ];
  it('never changes the word sequence (fillers included)', () => {
    for (const input of inputs) {
      const out = restoreNativePunctuation(input);
      expect(isWordPreserving(input, out)).toBe(true);
      expect(transcriptWordSequence(out)).toEqual(transcriptWordSequence(input));
    }
  });

  it('preserves every filler token exactly', () => {
    const out = restoreNativePunctuation('um i uh think like you know it was basically fine');
    const seq = transcriptWordSequence(out);
    for (const filler of ['um', 'uh', 'like', 'you', 'know', 'basically']) {
      expect(seq).toContain(filler);
    }
  });

  it('is idempotent (re-running does not add or move punctuation)', () => {
    for (const input of inputs) {
      const once = restoreNativePunctuation(input);
      expect(restoreNativePunctuation(once)).toBe(once);
    }
  });
});

describe('nativePunctuationRestore — seam integration (raw-first / guard / fallback)', () => {
  it('registers for Native mode and improves the saved transcript, word-preserving', async () => {
    expect(isNativePunctuationRestoreEnabled()).toBe(true); // default on
    registerNativeProductionFormatter('native');
    const formatted = await formatNativeTranscript(RUN_ON);
    expect(formatted).not.toBe(RUN_ON); // changed (casing + terminal period)
    expect(isWordPreserving(RUN_ON, formatted)).toBe(true);
    const t = getNativeFormatterTelemetry();
    expect(t?.provider).toBe('deterministic-restore');
    expect(t?.formatterVersion).toBe(NATIVE_PUNCTUATION_RESTORE_VERSION);
    expect(t?.fallbackToRaw).toBe(false);
    expect(t?.wordPreserving).toBe(true);
  });

  it('rejects a formatter that adds/removes/reorders words → keeps raw', async () => {
    registerNativeTranscriptFormatter((raw) => `${raw} extra`);
    expect(await formatNativeTranscript('hello world')).toBe('hello world');
    expect(getNativeFormatterTelemetry()?.wordPreserving).toBe(false);
    expect(getNativeFormatterTelemetry()?.errorCode).toBe('CLIENT_WORDS_CHANGED');
  });

  it('keeps raw when the restorer/provider throws', async () => {
    registerNativeTranscriptFormatter(() => { throw new Error('boom'); });
    expect(await formatNativeTranscript('hello world')).toBe('hello world');
    expect(getNativeFormatterTelemetry()?.fallbackToRaw).toBe(true);
  });

  it('falls back to raw when the formatter exceeds the latency budget', async () => {
    vi.useFakeTimers();
    registerNativeTranscriptFormatter(
      (raw) => new Promise<string>((resolve) => setTimeout(() => resolve(`${raw}.`), 20_000)),
    );
    const pending = formatNativeTranscript('hello world');
    await vi.advanceTimersByTimeAsync(FORMATTER_LATENCY_BUDGET_MS + 10);
    expect(await pending).toBe('hello world');
    expect(getNativeFormatterTelemetry()?.errorCode).toBe('FORMATTER_TIMEOUT_CLIENT');
    vi.useRealTimers();
  });
});

// Reviewer-corpus validation: run the SAME safe-cleanup invariants over the STT
// review corpus (not just the 4 hand-written strings). NOTE: this validates the
// deterministic transform's safety invariants — it is NOT a Native WER measurement,
// and fake-audio WER is never used as release proof.
describe('restoreNativePunctuation — reviewer corpus (tests/fixtures/speeches) invariants', () => {
  it('loaded the reviewer corpus (fail loud if fixtures missing)', () => {
    expect(REVIEWER_CORPUS.length).toBeGreaterThan(0);
  });

  it.each(REVIEWER_CORPUS.map((c) => [c.name, c.transcript, c.fillerWords] as const))(
    'corpus %s: word-preserving, fillers kept, no invented breaks, i-fixed, terminal, idempotent',
    (_name, transcript, fillerWords) => {
      const out = restoreNativePunctuation(transcript);
      // word-preserving (fillers included)
      expect(isWordPreserving(transcript, out)).toBe(true);
      expect(transcriptWordSequence(out)).toEqual(transcriptWordSequence(transcript));
      // fillers preserved exactly (multi-word fillers split into tokens)
      const outSeq = transcriptWordSequence(out);
      for (const filler of fillerWords) {
        for (const tok of filler.toLowerCase().split(/\s+/)) expect(outSeq).toContain(tok);
      }
      // no internal sentence breaks introduced ⇒ no false proper-noun boundaries
      expect(internalStops(out)).toBe(internalStops(transcript));
      // isolated "i" forms fixed — no bare lowercase "i" remains
      expect(out).not.toMatch(/(^|\s)i(\s|$)/);
      // terminal punctuation present
      expect(/[.!?]["')\]]*$/.test(out.trimEnd())).toBe(true);
      // idempotent
      expect(restoreNativePunctuation(out)).toBe(out);
    },
  );
});

describe('restoreNativePunctuation — Native human-proof regression fixture', () => {
  // Prior real Native human-mic proof text: Chrome emits erratic mid-sentence engine
  // capitals ("Starts Now"). Safe cleanup ONLY — no invented internal periods.
  const HUMAN_PROOF = 'speak sharp microphone proof Starts Now basically I want to make one simple point';
  it('safe cleanup only, no invented internal periods before Starts/Now', () => {
    const out = restoreNativePunctuation(HUMAN_PROOF);
    expect(out).toBe('Speak sharp microphone proof Starts Now basically I want to make one simple point.');
    expect(internalStops(out)).toBe(0); // no internal boundary invented
    expect(isWordPreserving(HUMAN_PROOF, out)).toBe(true);
    expect(restoreNativePunctuation(out)).toBe(out); // idempotent
  });
});

describe('nativePunctuationRestore — Private privacy guard', () => {
  it('Private mode can NEVER register the Native formatter', () => {
    expect(() => assertNotPrivateMode('private')).toThrow(/Private/);
    expect(() => registerNativeProductionFormatter('private')).toThrow(/Private/);
  });

  it('non-Native modes are a no-op (no formatter registered)', () => {
    expect(registerNativeProductionFormatter('cloud')).toBeNull();
  });
});
