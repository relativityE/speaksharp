export interface PracticeSession {
  id: string;
  user_id: string;
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
  clarity_score?: number;
  wpm?: number;
  pause_metrics?: {
    silencePercentage: number;
    transitionPauses: number;
    extendedPauses: number;
    longestPause: number;
  };
}
