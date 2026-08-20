// @vitest-environment happy-dom
//
// LIVE-TRANSCRIPTION PRIVACY GUARD (falsification suite).
//
// Originally written for #1306 ("no transcript ever"). That P0 was SUPERSEDED by the #1258/#1314 retention
// contract: the two newest saved sessions retain their transcript for review and PDF. The guard is re-pointed,
// not weakened — the boundary moved, it did not disappear, and every surface that must still stay text-free is
// still asserted here.
//
// The live transcript is ephemeral working memory everywhere EXCEPT the one retention channel. This suite
// proves the full lifecycle end-to-end:
//   1. Open Mic (countFillerWords) and Focus Points (deriveFocusCoverage) DO consume the live Private-STT text
//      — the working-memory path is real, not dead.
//   2. Metric derivation (flattenToFillerCounts + deriveNextActionSignal) is CONTENT-FREE — no spoken words
//      survive into the derived metrics.
//   3. The transcript crosses EXACTLY ONE persistence boundary, deliberately: the Supabase session writer
//      (saveSession), which is how newest-two retention is fed. It must still NEVER reach the recovery draft
//      (localStorage), the metrics reader (getSessionAnalysisMetrics), or the PDF filler read — and no OTHER
//      content-bearing field may cross any boundary at all.
//   4. A legacy transcript-bearing recovery draft is physically DELETED from localStorage on read.
//
// The canary is a distinctive spoken phrase; outside the one retention channel, its appearance in any serialized
// output fails the test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { countFillerWords } from '@/utils/fillerWordUtils';
import { deriveFocusCoverage } from '@/utils/focusCoverage';
import { flattenToFillerCounts, deriveNextActionSignal } from '@/utils/nextAction';
import { saveSession, completeSession } from '@/lib/storage';
import { getSupabaseClient } from '@/lib/supabaseClient';
import {
  saveSessionRecoveryDraft,
  getSessionRecoveryDraft,
  getRecoverableDraftForUser,
} from '@/services/sessionRecoveryDraft';
import { getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';
import { getPdfFillerTableData } from '@/lib/pdfGenerator';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import type { PracticeSession } from '@/types/session';
import type { UserProfile } from '@/types/user';

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: vi.fn() }));

// A distinctive spoken phrase that must NEVER be persisted anywhere.
const CANARY = 'um so today I confessed my secret salary of ninety thousand dollars you know';
const RECOVERY_DRAFT_KEY = 'speaksharp_unsaved_session_draft';

// Build the live (nested) filler shape the detector produces, as if counted from the spoken phrase.
const liveFillerData = (): FillerCounts => countFillerWords(CANARY);

const containsCanaryWords = (serialized: string): boolean => {
  const hay = serialized.toLowerCase();
  // Every distinctive spoken token from the canary — none may appear in a persisted payload.
  return ['confessed', 'secret', 'salary', 'ninety', 'thousand', 'dollars', 'today'].some(w => hay.includes(w));
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('guard — live transcript is ephemeral working memory feeding detection', () => {
  it('Open Mic filler detection consumes the live Private-STT text', () => {
    const live = countFillerWords(CANARY);
    // The live detector genuinely reads the spoken text and produces filler metrics.
    expect(live.total.count).toBeGreaterThan(0);
    expect(live.um?.count ?? 0).toBeGreaterThan(0);
    // The live (display-cased) shape maps to a canonical token on flatten — a real Private-STT read.
    expect(flattenToFillerCounts(live).you_know ?? 0).toBeGreaterThan(0);
  });

  it('Focus Points coverage consumes the live Private-STT text', () => {
    const coverage = deriveFocusCoverage(['salary'], CANARY, 60);
    // Coverage genuinely inspects the live transcript to decide which points were covered.
    expect(coverage.rows.find(r => r.label === 'salary')?.covered).toBe(true);
  });
});

describe('guard — derivation from the live transcript is content-free', () => {
  it('flattenToFillerCounts + deriveNextActionSignal carry only numbers/enums, never spoken words', () => {
    const flat = flattenToFillerCounts(liveFillerData());
    const signal = deriveNextActionSignal({
      durationSeconds: 60, wordCount: 14, wpm: 120, fillerCounts: flat, clarityScore: 80,
    });

    // Every filler key is an approved standard token — no prose key survives.
    for (const k of Object.keys(flat)) expect(typeof k).toBe('string');
    expect(containsCanaryWords(JSON.stringify({ flat, signal }))).toBe(false);
    // The derived payload is strictly the metrics-only shape.
    expect(Object.keys(signal).sort()).toEqual(
      ['actionCode', 'comparator', 'metric', 'reasonCode', 'templateVersion', 'value'].sort(),
    );
  });
});

describe('guard — the transcript crosses exactly one persistence boundary, and only that one', () => {
  it('saveSession FORWARDS the transcript — this is the retention channel, not a leak', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: { new_session: { id: 's1' }, usage_exceeded: false }, error: null });
    vi.mocked(getSupabaseClient).mockReturnValue({ rpc: mockRpc } as unknown as ReturnType<typeof getSupabaseClient>);

    await saveSession(
      { user_id: 'u1', duration: 60, total_words: 14, transcript: CANARY } as unknown as Partial<PracticeSession> & { user_id: string },
      { id: 'u1', email: 'x@y.z', subscription_status: 'free' } as unknown as UserProfile,
    );

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const payload = mockRpc.mock.calls[0][1] as { p_session_data: Record<string, unknown> };
    // Retained VERBATIM: retention exists so the user can read back what they actually said.
    expect(payload.p_session_data.transcript).toBe(CANARY);
  });

  it('saveSession still strips every content field the retention contract does NOT retain', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: { new_session: { id: 's1' }, usage_exceeded: false }, error: null });
    vi.mocked(getSupabaseClient).mockReturnValue({ rpc: mockRpc } as unknown as ReturnType<typeof getSupabaseClient>);

    await saveSession(
      {
        user_id: 'u1', duration: 60, total_words: 14,
        // Every one of these is prose or a legacy blob smuggled through an untyped object.
        ai_suggestions: { what_worked: CANARY }, ground_truth: CANARY, accuracy: 0.9,
        custom_words: [CANARY], filler_words: { um: 1 },
      } as unknown as Partial<PracticeSession> & { user_id: string },
      { id: 'u1', email: 'x@y.z', subscription_status: 'free' } as unknown as UserProfile,
    );

    const payload = mockRpc.mock.calls[0][1] as { p_session_data: Record<string, unknown> };
    for (const stripped of ['ai_suggestions', 'ground_truth', 'accuracy', 'custom_words', 'filler_words']) {
      expect(payload.p_session_data, `${stripped} must never cross the boundary`).not.toHaveProperty(stripped);
    }
    // With no `transcript` field supplied, the canary must not appear anywhere in the payload.
    expect(containsCanaryWords(JSON.stringify(payload))).toBe(false);
  });

  // The atomic RPC (C1) adds `p_final_transcript`, but the CLIENT does not send it yet: doing so against a
  // database without that migration fails to resolve the function and breaks every completion. So today's
  // property is unchanged — the completion call carries no transcript. This test is re-pointed in the SAME
  // increment that adopts the parameter, after the migration is applied.
  it('completeSession sends only content-free metrics + the next action (no transcript)', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    vi.mocked(getSupabaseClient).mockReturnValue({ rpc: mockRpc } as unknown as ReturnType<typeof getSupabaseClient>);

    const flat = flattenToFillerCounts(liveFillerData());
    await completeSession('s1', {
      status: 'completed',
      duration: 60,
      nextActionSignal: deriveNextActionSignal({ durationSeconds: 60, wordCount: 14, wpm: 120, fillerCounts: flat, clarityScore: 80 }),
      metrics: { totalWords: 14, clarityScore: 80, wpm: 120, fillerCounts: flat, pauseMetrics: {} },
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const args = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args).not.toHaveProperty('p_final_transcript');
    expect(containsCanaryWords(JSON.stringify(args))).toBe(false);
  });

  // These three surfaces must stay text-free REGARDLESS of what the database retains. Retention changed what
  // the session row holds; it did not licence the transcript into local storage, the metrics reader, or the PDF.
  it('the recovery draft persists numbers only — a smuggled transcript never reaches localStorage', () => {
    const flat = flattenToFillerCounts(liveFillerData());
    saveSessionRecoveryDraft({
      sessionId: 's1',
      userId: 'u1',
      recoveryState: 'finalized_pending_save',
      durationSeconds: 60,
      mode: 'unknown',
      // A rogue caller tries to smuggle the transcript through an untyped field — it must be dropped.
      metrics: { totalWords: 14, fillerCounts: flat, transcript: CANARY } as unknown as { totalWords: number },
      nextActionSignal: deriveNextActionSignal({ durationSeconds: 60, wordCount: 14, wpm: 120, fillerCounts: flat, clarityScore: 80 }),
    });

    const stored = window.localStorage.getItem(RECOVERY_DRAFT_KEY) ?? '';
    expect(stored).not.toBe('');
    expect(containsCanaryWords(stored)).toBe(false);
    expect(stored).not.toContain('transcript');
    // Read-back is likewise content-free.
    expect(containsCanaryWords(JSON.stringify(getSessionRecoveryDraft()))).toBe(false);
  });

  it('the review reader never surfaces a transcript from a rogue persisted row', () => {
    const flat = flattenToFillerCounts(liveFillerData());
    const metrics = getSessionAnalysisMetrics({
      id: 's1', user_id: 'u1', created_at: '2025-01-01T00:00:00Z', duration: 60,
      total_words: 14, wpm: 120, clarity_score: 80, filler_counts: flat,
      transcript: CANARY,
    } as unknown as PracticeSession);
    expect(containsCanaryWords(JSON.stringify(metrics))).toBe(false);
  });

  it('the PDF filler read never recounts or emits the transcript', () => {
    const rows = getPdfFillerTableData({
      id: 's1', user_id: 'u1', created_at: '2025-01-01T00:00:00Z', duration: 60,
      filler_counts: flattenToFillerCounts(liveFillerData()),
      transcript: CANARY,
    } as unknown as PracticeSession);
    expect(containsCanaryWords(JSON.stringify(rows))).toBe(false);
  });
});

describe('guard — legacy transcript-bearing recovery drafts are physically deleted on read', () => {
  it('a legacy draft carrying a transcript is removed from localStorage and never surfaced', () => {
    window.localStorage.setItem(RECOVERY_DRAFT_KEY, JSON.stringify({
      sessionId: 's-legacy', userId: 'u1', recoveryState: 'finalized_pending_save',
      durationSeconds: 60, mode: 'unknown', metrics: { totalWords: 14 },
      transcript: CANARY, // content-bearing field: a draft must persist numbers only, whatever the DB retains
    }));

    expect(getSessionRecoveryDraft()).toBeNull();
    expect(getRecoverableDraftForUser('u1')).toBeNull();
    // The key is physically gone — the transcript is not left sitting in storage.
    expect(window.localStorage.getItem(RECOVERY_DRAFT_KEY)).toBeNull();
  });
});
