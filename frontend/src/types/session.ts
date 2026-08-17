import type { NextActionSignal } from '@/contracts/nextActionSignal';
import type { PersistedFillerCounts } from '@/contracts/fillerCounts';

/**
 * #1306 METRICS-ONLY. A persisted practice session carries content-free metrics + one structured next action.
 * NO transcript, transcript excerpt, raw STT output, quoted speech, coaching prose, ground truth, per-session
 * accuracy, or custom words ever appears here — post-session code CANNOT receive transcript text at compile time
 * (the fields simply do not exist on the type).
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
  /** Vestigial server-owned state (transcript retention retired); metrics-only rows are effectively not_captured. */
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
