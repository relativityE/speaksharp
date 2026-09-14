// @vitest-environment node
/**
 * Per-take WER receipt — PM decision 5670960608 ("Comparison evidence / WER").
 *
 * The corpus passages are PO-held (#1464 5663167306): the tester supplies the reference LOCALLY, the take's
 * recognized text is read locally, and the receipt may carry only counts, model identity, and content-free
 * correlation. It is computed immediately after each take, before the next save can expire the transcript.
 * These casualties pin that contract before the tool exists.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TRACK_NORMALIZATION } from '../evidence/normalization/tracks';

const load = () => import('../../scripts/human-test/perTakeWer.mts');

const RELEASE = '46cd4b8c9c2510977b18ba69fbe8f0256f2b370a';
const NONCE = '3f1c9a2e-7b4d-4e8a-9c21-5d6f0a1b2c3d';
const CANDIDATE = 'v2:base.en';
/** Words that must never leave the tool: if any appears in output, content leaked. */
const SECRET_REF = 'the zyxwvu quick brown fox';
const SECRET_HYP = 'the qwertyplum quick brown box extra';
const LEAK_TOKENS = ['zyxwvu', 'qwertyplum', 'fox', 'box', 'brown'];

const RECEIPT_KEYS = [
  'candidateId', 'comparisonNonce', 'deletions', 'evidenceKind', 'hypothesisWords', 'insertions',
  'normalizationVersion', 'referenceWords', 'releaseSha', 'substitutions', 'track', 'wer',
].sort();

const base = { candidateId: CANDIDATE, releaseSha: RELEASE, comparisonNonce: NONCE };

function expectNoContent(value: unknown) {
  const text = JSON.stringify(value);
  for (const token of LEAK_TOKENS) expect(text, `output leaked "${token}"`).not.toContain(token);
}

describe('per-take WER receipt contract', () => {
  it('emits exactly the content-free receipt fields, with the track normalization identity', async () => {
    const { scorePerTake } = await load();
    const result = scorePerTake({ ...base, reference: SECRET_REF, hypothesis: SECRET_HYP, track: 'track_b' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.receipt).sort()).toEqual(RECEIPT_KEYS);
    expect(result.receipt.evidenceKind).toBe('per_take_wer_v1');
    expect(result.receipt.track).toBe('track_b');
    expect(result.receipt.normalizationVersion).toBe(TRACK_NORMALIZATION.track_b);
    expect(result.receipt).toMatchObject({ candidateId: CANDIDATE, releaseSha: RELEASE, comparisonNonce: NONCE });
  });

  it('counts substitutions, deletions and insertions against the reference word basis', async () => {
    const { scorePerTake } = await load();
    const result = scorePerTake({ ...base, reference: 'the quick brown fox', hypothesis: 'the quick brown box extra', track: 'track_b' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt).toMatchObject({ substitutions: 1, deletions: 0, insertions: 1, referenceWords: 4, hypothesisWords: 5 });
    expect(result.receipt.wer).toBeCloseTo(0.5, 10);
  });

  it('an empty hypothesis is all deletions (WER 1), not a refusal', async () => {
    const { scorePerTake } = await load();
    const result = scorePerTake({ ...base, reference: 'the quick brown fox', hypothesis: '', track: 'track_b' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt).toMatchObject({ deletions: 4, hypothesisWords: 0, referenceWords: 4, wer: 1 });
  });

  it('REFUSES an empty reference — an unmeasurable take is never scored 0', async () => {
    const { scorePerTake } = await load();
    const result = scorePerTake({ ...base, reference: '   ', hypothesis: SECRET_HYP, track: 'track_b' });
    expect(result).toEqual({ ok: false, reason: 'reference_empty' });
  });

  it('REFUSES a missing track — there is no default scoring track', async () => {
    const { scorePerTake } = await load();
    const result = scorePerTake({ ...base, reference: SECRET_REF, hypothesis: SECRET_HYP } as never);
    expect(result).toEqual({ ok: false, reason: 'track_required' });
  });

  it('the track decides filler handling: Track A drops "um", Track B scores it', async () => {
    const { scorePerTake } = await load();
    const a = scorePerTake({ ...base, reference: 'the quick fox', hypothesis: 'um the quick fox', track: 'track_a' });
    const b = scorePerTake({ ...base, reference: 'the quick fox', hypothesis: 'um the quick fox', track: 'track_b' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.receipt.wer).toBe(0);
    expect(b.receipt.insertions).toBe(1);
  });

  it('REFUSES malformed identity without echoing the rejected value', async () => {
    const { scorePerTake } = await load();
    const bad = [
      [{ releaseSha: 'zyxwvu' }, 'release_sha_invalid'],
      [{ comparisonNonce: 'qwertyplum' }, 'comparison_nonce_invalid'],
      [{ candidateId: 'zyxwvu brown fox' }, 'candidate_id_invalid'],
    ] as const;
    for (const [override, reason] of bad) {
      const result = scorePerTake({ ...base, ...override, reference: SECRET_REF, hypothesis: SECRET_HYP, track: 'track_b' });
      expect(result).toEqual({ ok: false, reason });
      expectNoContent(result);
    }
  });

  it('PRIVACY: no reference or hypothesis word appears anywhere in a successful result', async () => {
    const { scorePerTake } = await load();
    const result = scorePerTake({ ...base, reference: SECRET_REF, hypothesis: SECRET_HYP, track: 'track_b' });
    expect(result.ok).toBe(true);
    expectNoContent(result);
  });
});

describe('per-take WER CLI', () => {
  const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
  const script = resolve(process.cwd(), 'scripts/human-test/per-take-wer.mts');

  function run(args: string[]) {
    try {
      return { code: 0, stdout: execFileSync(tsx, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
    }
  }

  it('reads local files and prints only the receipt JSON; the texts never reach stdout or stderr', () => {
    const dir = mkdtempSync(join(tmpdir(), 'per-take-wer-'));
    try {
      const ref = join(dir, 'reference.txt');
      const hyp = join(dir, 'hypothesis.txt');
      writeFileSync(ref, SECRET_REF);
      writeFileSync(hyp, SECRET_HYP);
      const out = run(['--reference', ref, '--hypothesis', hyp, '--track', 'track_b',
        '--candidate', CANDIDATE, '--release', RELEASE, '--nonce', NONCE]);
      expect(out.code).toBe(0);
      const receipt = JSON.parse(out.stdout);
      expect(Object.keys(receipt).sort()).toEqual(RECEIPT_KEYS);
      for (const token of LEAK_TOKENS) {
        expect(out.stdout).not.toContain(token);
        expect(out.stderr).not.toContain(token);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a refusal exits non-zero and prints only the reason code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'per-take-wer-'));
    try {
      const ref = join(dir, 'reference.txt');
      const hyp = join(dir, 'hypothesis.txt');
      writeFileSync(ref, '');
      writeFileSync(hyp, SECRET_HYP);
      const out = run(['--reference', ref, '--hypothesis', hyp, '--track', 'track_b',
        '--candidate', CANDIDATE, '--release', RELEASE, '--nonce', NONCE]);
      expect(out.code).not.toBe(0);
      expect(`${out.stdout}${out.stderr}`).toContain('reference_empty');
      for (const token of LEAK_TOKENS) expect(`${out.stdout}${out.stderr}`).not.toContain(token);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
