/**
 * Non-mutating repetition-risk DETECTOR for saved transcripts.
 * ============================================================================
 * Whisper loops phrases on short/ambiguous audio (a known failure class: hallucinated
 * repeats around silence / low-speech regions). Per the team's data-integrity decision
 * (commits f846d560 / 3ee15110 — "never delete a genuine repeat", "route Private garbling
 * to model/VAD"), we DO NOT delete possibly-genuine repeats. This detector ONLY FLAGS the
 * risk so evidence/telemetry can surface it; it NEVER modifies the transcript.
 *
 * It can therefore be more aggressive than the (mutating) collapse guard — flagging 2x and
 * interleaved repeats too — because a false positive only adds an observability flag, never
 * corrupts saved user text. The principled fix for the underlying loops is VAD/segmentation
 * (queued as a post-release STT reliability lane), not text deletion.
 */

export interface RepetitionRiskResult {
  /** True when the saved transcript shows a Whisper-loop repetition signature. */
  repetitionRisk: boolean;
  /** Coarse reason code for the flag (null when no risk). */
  repetitionRiskReason:
    | 'adjacent_loop'
    | 'near_whole_doubling'
    | 'repeated_span'
    | null;
  /** Short human-readable summary of the repeated span (null when no risk). Evidence/debug only. */
  repeatedSpanSummary: string | null;
}

const NO_RISK: RepetitionRiskResult = {
  repetitionRisk: false,
  repetitionRiskReason: null,
  repeatedSpanSummary: null,
};

const REPEATED_SPAN_K = 4; // a 4+ word span recurring is a strong (non-adjacent) loop signal.
const NEAR_DOUBLING_MATCH_RATIO = 0.8;
const MIN_TOKENS = 6; // below this, repeats ("I think, I think") are too likely genuine to flag.

/**
 * Detect (do NOT alter) repetition-loop risk in a transcript. Pure + side-effect-free.
 */
export function detectRepetitionRisk(text: string): RepetitionRiskResult {
  const raw = (text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return NO_RISK;

  const tokens = raw.split(' ');
  const norm = tokens
    .map((t) => t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  const n = norm.length;
  if (n < MIN_TOKENS) return NO_RISK;

  const seqEq = (a: number, b: number, k: number): boolean => {
    for (let x = 0; x < k; x++) {
      if (norm[a + x] !== norm[b + x]) return false;
    }
    return true;
  };

  // 1. Adjacent multi-word loop: a 2..40-word unit repeated >= 3x back-to-back.
  for (let i = 0; i < n; i++) {
    const maxK = Math.min(40, Math.floor((n - i) / 3));
    for (let k = 2; k <= maxK; k++) {
      let reps = 1;
      while (i + (reps + 1) * k <= n && seqEq(i, i + reps * k, k)) reps++;
      if (reps >= 3) {
        return {
          repetitionRisk: true,
          repetitionRiskReason: 'adjacent_loop',
          repeatedSpanSummary: `"${norm.slice(i, i + k).join(' ')}" x${reps}`,
        };
      }
    }
  }

  // 2. Near whole-text doubling: first half ~= second half (>= 80% token match).
  if (n >= 8) {
    const half = Math.floor(n / 2);
    let match = 0;
    for (let x = 0; x < half; x++) {
      if (norm[x] === norm[n - half + x]) match++;
    }
    if (match / half >= NEAR_DOUBLING_MATCH_RATIO) {
      return {
        repetitionRisk: true,
        repetitionRiskReason: 'near_whole_doubling',
        repeatedSpanSummary: `${norm.slice(0, Math.min(half, 6)).join(' ')}… (doubled, ${Math.round((match / half) * 100)}%)`,
      };
    }
  }

  // 3. Non-adjacent repeated span: a K-word span recurring (non-overlapping) elsewhere.
  //    Catches interleaved loops like "basically … wait, um, basically … basically".
  const firstSeen = new Map<string, number>();
  for (let i = 0; i + REPEATED_SPAN_K <= n; i++) {
    const key = norm.slice(i, i + REPEATED_SPAN_K).join(' ');
    const prev = firstSeen.get(key);
    if (prev !== undefined && i - prev >= REPEATED_SPAN_K) {
      return {
        repetitionRisk: true,
        repetitionRiskReason: 'repeated_span',
        repeatedSpanSummary: `"${key}" (>=2x)`,
      };
    }
    if (prev === undefined) firstSeen.set(key, i);
  }

  return NO_RISK;
}

/**
 * Collapse Whisper repetition loops in a DECODED transcript. Whisper can loop a
 * phrase/sentence many times on short or ambiguous audio (e.g. "we should wait we
 * should wait we should wait …"), inflating the saved transcript (verdict-A
 * duplication in `service_result`). This collapses an immediately-repeated
 * multi-word unit (>= 2 words repeated >= 3 times back-to-back), and an exact
 * verbatim whole-text doubling, down to a single instance.
 *
 * It is deliberately CONSERVATIVE so it can never alter a legitimate transcript:
 * a 2+ word phrase repeated 3+ times in a row, or a verbatim first-half doubling,
 * are loop signatures natural speech does not produce. Single words ("no no no")
 * and 2x phrase repeats ("I think, I think") are left untouched.
 *
 * Unlike `detectRepetitionRisk` (flag-only), this MUTATES — it is the engine/final-
 * result guard applied at decode and at the authoritative stop-transcript boundary.
 */
export function collapseTranscriptRepetitionLoops(text: string): string {
  const raw = (text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return raw;
  const tokens = raw.split(' ');
  const n = tokens.length;
  if (n < 4) return raw;

  const norm = tokens.map((t) => t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  const seqEq = (a: number, b: number, k: number): boolean => {
    for (let x = 0; x < k; x++) {
      if (norm[a + x] !== norm[b + x]) return false;
    }
    return true;
  };

  // 1. Exact verbatim whole-text doubling (the first half repeated once).
  if (n % 2 === 0 && n >= 8 && seqEq(0, n / 2, n / 2)) {
    return tokens.slice(0, n / 2).join(' ');
  }

  // 2. Immediate multi-word loop: a k-word unit (2..40) repeated >= 3 times.
  const out: string[] = [];
  let i = 0;
  while (i < n) {
    let collapsed = false;
    const maxK = Math.min(40, Math.floor((n - i) / 3));
    for (let k = 2; k <= maxK; k++) {
      let reps = 1;
      while (i + (reps + 1) * k <= n && seqEq(i, i + reps * k, k)) reps++;
      if (reps >= 3) {
        for (let x = 0; x < k; x++) out.push(tokens[i + x]);
        i += reps * k;
        collapsed = true;
        break;
      }
    }
    if (!collapsed) {
      out.push(tokens[i]);
      i++;
    }
  }
  return out.join(' ');
}
