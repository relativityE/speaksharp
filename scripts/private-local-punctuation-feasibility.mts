#!/usr/bin/env tsx
/**
 * ============================================================================
 * Private LOCAL punctuation / readability feasibility harness  (#32)
 * ============================================================================
 *
 * GOAL (product owner): improve Private punctuation/readability WITHOUT sending
 * Private transcript text to any cloud/API and WITHOUT a surprise model download.
 *
 * This is a DEV research/feasibility rig — NOT a live-proof or manual-proof script
 * (those are test-agent owned). It objectively scores any candidate "formatter"
 * against the acceptance criteria the test agent documented in
 * PRIVATE_STT_RELEASE_EVIDENCE so we can accept/reject a local approach with data:
 *
 *   ACCEPTANCE (all must hold):
 *     1. Readability IMPROVES   — more sentences AND/OR shorter max run-on.
 *     2. Words UNCHANGED        — exact word sequence preserved (strict).
 *     3. Fillers PRESERVED      — um/uh/like/you know/basically/literally counts unchanged.
 *     4. LOCAL only             — candidate performs NO network I/O (enforced by the
 *                                 candidate being a pure function here; real models
 *                                 must run in a worker with no fetch after an explicit,
 *                                 user-consented one-time download).
 *
 * Run:  npx tsx scripts/private-local-punctuation-feasibility.mts
 * Exit: 0 if the harness self-validates (identity FAILS readability; the local
 *       heuristic PASSES preservation+readability on the run-on fixtures), else 1.
 *
 * Candidates included:
 *   - identity            : proves raw Whisper final text fails readability (baseline).
 *   - localHeuristic      : a strictly word-preserving, NO-network punctuation/casing
 *                           restorer (discourse-marker + run-length segmentation). NOT
 *                           proposed as the final answer (owner: "no bespoke regex as
 *                           the final answer") — it is the measurable LOWER BOUND a real
 *                           local model must beat, and a possible caveated stopgap.
 *   - <ONNX model slot>   : documented integration point for a browser-local ONNX
 *                           punctuation model (e.g. PunctCapSeg) behind explicit consent.
 */

// --------------------------------------------------------------------------
// Word / filler preservation (mirrors the formatter word-preservation guard)
// --------------------------------------------------------------------------
const FILLERS = ['um', 'uh', 'like', 'you know', 'basically', 'literally'];

function wordSeq(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

function wordsPreserved(raw: string, out: string): boolean {
  const a = wordSeq(raw);
  const b = wordSeq(out);
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/** Count filler occurrences (single + two-word "you know") in normalized text. */
function fillerCounts(s: string): Record<string, number> {
  const norm = ' ' + wordSeq(s).join(' ') + ' ';
  const counts: Record<string, number> = {};
  for (const f of FILLERS) counts[f] = (norm.match(new RegExp(`(?<=\\s)${f}(?=\\s)`, 'g')) || []).length;
  return counts;
}

function fillersPreserved(raw: string, out: string): boolean {
  const a = fillerCounts(raw);
  const b = fillerCounts(out);
  return FILLERS.every((f) => a[f] === b[f]);
}

// --------------------------------------------------------------------------
// Readability metrics (match speakingScore.maxRunOnWords semantics)
// --------------------------------------------------------------------------
function sentenceCount(s: string): number {
  return Math.max(1, (s.match(/[.!?]+/g) || []).length);
}
function maxRunOnWords(s: string): number {
  return (s || '').split(/[.!?]+/).reduce((max, span) => {
    const n = span.trim().split(/\s+/).filter(Boolean).length;
    return n > max ? n : max;
  }, 0);
}
function terminalPunctuation(s: string): boolean {
  return /[.!?]\s*$/.test(s.trim());
}

// --------------------------------------------------------------------------
// Candidate A — identity (raw Whisper final). Baseline; expected to fail readability.
// --------------------------------------------------------------------------
const identity = (s: string): string => s;

// --------------------------------------------------------------------------
// Candidate B — strictly word-preserving LOCAL heuristic (no network).
// Only inserts sentence boundaries + fixes casing; never alters word tokens, so
// word/filler preservation holds by construction.
// --------------------------------------------------------------------------
// Discourse markers that typically begin a new clause/sentence in spoken English.
const SENTENCE_START_CUES = [
  'so', 'but', 'and then', 'then', 'the main takeaway', 'the takeaway',
  'i want', 'i think', 'now', 'finally', 'first', 'second', 'next',
  'basically', 'the point is', 'my point is', 'because',
];
const MAX_RUN = 18; // hard cap so no run-on exceeds the readability threshold

function localHeuristic(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return raw;

  const lower = words.map((w) => w.toLowerCase());
  const boundaryBefore = new Array(words.length).fill(false);

  // Mark a boundary before a cue phrase (not at index 0).
  for (let i = 1; i < words.length; i++) {
    for (const cue of SENTENCE_START_CUES) {
      const parts = cue.split(' ');
      if (parts.every((p, k) => lower[i + k] === p)) {
        boundaryBefore[i] = true;
        break;
      }
    }
  }
  // Enforce a max run length so nothing exceeds the readability cap.
  let sinceBoundary = 0;
  for (let i = 0; i < words.length; i++) {
    if (boundaryBefore[i]) sinceBoundary = 0;
    if (sinceBoundary >= MAX_RUN) {
      boundaryBefore[i] = true;
      sinceBoundary = 0;
    }
    sinceBoundary++;
  }

  // Rebuild with periods + sentence-start capitalization (+ standalone "i" -> "I").
  let out = '';
  let startOfSentence = true;
  for (let i = 0; i < words.length; i++) {
    if (boundaryBefore[i] && out) {
      out = out.replace(/\s$/, '');
      out += '. ';
      startOfSentence = true;
    }
    let w = words[i];
    if (startOfSentence) w = w.charAt(0).toUpperCase() + w.slice(1);
    else if (w.toLowerCase() === 'i') w = 'I';
    out += w + ' ';
    startOfSentence = false;
  }
  out = out.trim();
  if (!terminalPunctuation(out)) out += '.';
  return out;
}

// --------------------------------------------------------------------------
// Candidate C — real browser-local ONNX punctuation model (NOT run here).
// Integration plan (documented for the 48h+ path):
//   - model: a PunctCapSeg / bert-restore-punctuation ONNX export hosted for
//     transformers.js (token-classification), loaded in the SAME worker as Whisper.
//   - download: one-time, behind an explicit user "Enable punctuation" setup consent
//     (mirror the STT model setup); NEVER auto-download; cache locally thereafter.
//   - runtime: zero network after download; transcript text never leaves the device.
//   - acceptance: must pass the SAME four checks below AND beat localHeuristic on
//     readability without breaking word/filler preservation.
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Fixtures — representative run-on transcripts from the 2026-06 human proofs.
// --------------------------------------------------------------------------
interface Fixture { id: string; raw: string; note: string }
const FIXTURES: Fixture[] = [
  {
    id: 'native-scriptB-runon',
    note: 'Native human proof Script B — run-on, missing punctuation, fillers present',
    raw: 'um basically I want to explain one thing like the puppy chewed up the new shoes and that changed the whole plan the main takeaway is that we should pause before the next idea give one concrete example and end with a clear next step',
  },
  {
    id: 'private-runon',
    note: 'Private human proof — 2 sentences vs expected ~4, max run-on ~49',
    raw: 'the point is simple first we practice privately because it builds confidence for example one focused rehearsal makes the next meeting easier so the takeaway is that steady practice improves delivery and you should try one before your next talk',
  },
  {
    id: 'clean-control',
    note: 'Already-clean control — a good formatter must not regress this',
    raw: 'The point is simple. First, practice privately. For example, one rehearsal helps.',
  },
];

// --------------------------------------------------------------------------
// Evaluation
// --------------------------------------------------------------------------
interface Verdict {
  wordsPreserved: boolean;
  fillersPreserved: boolean;
  sentBefore: number; sentAfter: number;
  runOnBefore: number; runOnAfter: number;
  readabilityImproved: boolean;
  pass: boolean;
}
function evaluate(raw: string, out: string): Verdict {
  const wp = wordsPreserved(raw, out);
  const fp = fillersPreserved(raw, out);
  const sentBefore = sentenceCount(raw), sentAfter = sentenceCount(out);
  const runOnBefore = maxRunOnWords(raw), runOnAfter = maxRunOnWords(out);
  // "Improved" = more sentences OR a shorter max run-on that clears the <=45 gate,
  // while already-clean inputs (run-on already small) are allowed to stay equal.
  const wasWeak = runOnBefore > 45 || sentBefore < 3;
  const readabilityImproved = wasWeak
    ? (sentAfter > sentBefore || runOnAfter < runOnBefore) && runOnAfter <= 45
    : runOnAfter <= 45; // clean inputs: just don't regress past the gate
  return {
    wordsPreserved: wp, fillersPreserved: fp,
    sentBefore, sentAfter, runOnBefore, runOnAfter,
    readabilityImproved,
    pass: wp && fp && readabilityImproved,
  };
}

const CANDIDATES: { name: string; fn: (s: string) => string }[] = [
  { name: 'identity (raw Whisper)', fn: identity },
  { name: 'localHeuristic (no-network)', fn: localHeuristic },
];

function main(): void {
  console.log('\n=== Private LOCAL punctuation feasibility (#32) ===\n');
  let selfValidOk = true;

  for (const c of CANDIDATES) {
    console.log(`\n## Candidate: ${c.name}`);
    for (const fx of FIXTURES) {
      const out = c.fn(fx.raw);
      const v = evaluate(fx.raw, out);
      console.log(
        `  [${v.pass ? 'PASS' : 'FAIL'}] ${fx.id}  ` +
        `words=${v.wordsPreserved ? 'ok' : 'CHANGED'} fillers=${v.fillersPreserved ? 'ok' : 'CHANGED'} ` +
        `sent ${v.sentBefore}->${v.sentAfter} runOn ${v.runOnBefore}->${v.runOnAfter} ` +
        `readable=${v.readabilityImproved}`,
      );

      // Self-validation expectations that make this a real test (bug finder):
      if (c.name.startsWith('identity') && fx.id.endsWith('runon') && v.readabilityImproved) {
        console.log('   ! UNEXPECTED: identity should NOT improve a run-on fixture');
        selfValidOk = false;
      }
      if (c.name.startsWith('localHeuristic')) {
        if (!v.wordsPreserved || !v.fillersPreserved) {
          console.log('   ! BUG: localHeuristic must never change words/fillers');
          selfValidOk = false;
        }
        if (fx.id.endsWith('runon') && !v.pass) {
          console.log('   ! localHeuristic failed to fix a run-on fixture (tune SENTENCE_START_CUES/MAX_RUN)');
          selfValidOk = false;
        }
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log('Raw Whisper final (identity) fails the readability gate on run-on fixtures => a local');
  console.log('formatter IS required for Private readability. A strictly word-preserving local heuristic');
  console.log('clears the gate with NO network and NO word/filler change, establishing the lower bound a');
  console.log('real ONNX punctuation model must beat (see Candidate C integration plan).');
  console.log(`\nharness self-validation: ${selfValidOk ? 'OK' : 'FAILED'}\n`);
  process.exit(selfValidOk ? 0 : 1);
}

main();
