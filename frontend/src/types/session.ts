export interface PracticeSession {
  id: string;
  user_id: string;
  status?: 'active' | 'completed' | 'failed' | null;
  created_at: string;
  duration: number;
  title?: string;
  total_words?: number;
  transcript?: string;
  filler_words?: {
    [key: string]: {
      count: number;
    };
  };
  accuracy?: number;
  ground_truth?: string;
  engine?: string;
  engine_version?: string;
  model_name?: string;
  device_type?: string;
  /** #1033 STT attribution lifecycle: legacy_unknown | pending | verified | unverified. */
  attribution_status?: import('@/constants/attributionStatus').AttributionStatus;
  /** #1047 PR-U1 server-owned transcript state: available | expired | not_captured. */
  transcript_state?: import('@/constants/transcriptState').TranscriptState;
  custom_words?: Record<string, unknown>;
  clarity_score?: number;
  wpm?: number;
  ai_suggestions?: {
    summary: string;
    suggestions: Array<{ title: string; description: string }>;
  };
  pause_metrics?: {
    silencePercentage: number;
    transitionPauses: number;
    extendedPauses: number;
    longestPause: number;
  };
}
