import type { NextActionSignal } from '@/contracts/nextActionSignal';
import type { PersistedFillerCounts } from '@/contracts/fillerCounts';

/**
 * A persisted practice session: metrics, one structured next action, and — for the two newest sessions only —
 * the retained transcript.
 *
 * #1306 originally made this type strictly content-free ("no transcript ever"). That P0 was SUPERSEDED by the
 * #1258/#1314 retention contract, which retains the transcript of the two newest saved sessions for review and
 * PDF and deletes it thereafter. `transcript` is therefore back on the type deliberately — it is not a leak and
 * not an oversight, and it should not be "cleaned up" by anyone reading the older #1306 comments.
 *
 * Everything else #1306 removed STAYS removed: no ai_suggestions/coaching prose, no ground_truth, no per-session
 * accuracy, no custom words, and no loosely-typed legacy `filler_words` blob. Those were not part of the
 * superseding contract, so post-session code still cannot receive them at compile time.
 */
export interface PracticeSession {
  id: string;
  user_id: string;
  status?: 'active' | 'completed' | 'failed' | null;
  created_at: string;
  duration: number;
  title?: string;
  total_words?: number;
  /** Strict flat filler tally — APPROVED standard keys only ({ um: 3, uh: 1 }); `{}` = measured zero. Never a
   *  nested/free-form/prose-keyed map. Runtime-validated at the persistence boundary + read path. */
  filler_counts?: PersistedFillerCounts;
  engine?: string;
  engine_version?: string;
  model_name?: string;
  device_type?: string;
  /** #1033 STT attribution lifecycle: legacy_unknown | pending | verified | unverified. */
  attribution_status?: import('@/constants/attributionStatus').AttributionStatus;
  /**
   * The retained transcript — present only while this session is within the newest-two retention window; absent
   * or empty once the server has expired it. NEVER infer expiry from emptiness: `transcript_state` is the
   * server-owned authority for that distinction (`available` / `expired` / `not_captured`).
   */
  transcript?: string | null;
  /** SERVER-OWNED retention state; the only honest way to tell "expired" from "never captured". Clients read it,
   *  never assert it (a DB trigger maintains it). */
  transcript_state?: import('@/constants/transcriptState').TranscriptState;
  clarity_score?: number;
  wpm?: number;
  /** The ONE metrics-derived next action for a successfully completed session; null for incomplete/failed. */
  next_action_signal?: NextActionSignal | null;
  /** Aggregate pause metrics only (no raw timestamps). */
  pause_metrics?: {
    totalPauses?: number;
    averagePauseDuration?: number;
    longestPause?: number;
    pausesPerMinute?: number;
    silencePercentage?: number;
    transitionPauses?: number;
    extendedPauses?: number;
  };
}
