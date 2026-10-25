export interface FillerWordTrends {
  [key: string]: {
    current: number;
    previous: number;
  };
}

export interface ChartDataPoint {
  date: string;
  // #1047: `null` = a not_captured row — the filler rate is OMITTED (a gap), never a fabricated value,
  // exactly as clarity is omitted below. Mirrors the RPC chart-point provenance gate.
  'FW/min': string | number | null;
  /**
   * #1091: `null` means this session carries no scorable clarity evidence — an OMITTED point, which
   * Recharts renders as a gap in the line. It is never `0` and never `100`: the previous server series
   * fabricated a perfect 100 for an unmeasured session, and the client series fabricated a 0. A chart
   * point must not assert a score the session never produced.
   */
  clarity: number | null;
  [key: string]: string | number | null;
}

export interface OverallStats {
  totalSessions: number;
  totalPracticeTime: number;
  /** #1045: exact seconds, so the display layer can say "<1 min" instead of rounding to "0 mins". */
  totalPracticeTimeSeconds: number;
  /**
   * #1045: `null` means "not enough valid evidence to compute this", which is materially different
   * from a genuine `0`. Every consumer must render NOT_ENOUGH_DATA rather than a number, a bare unit,
   * or a judgment label when it sees null. See utils/metricValidity.ts.
   */
  averageSessionLength: number | null;
  averageSessionLengthSeconds: number | null;
  averageWPM: number | null;
  avgFillerWordsPerMin: string | number | null;
  avgClarity: string | number | null;
  avgPausesPerMin: string | number | null;
  chartData: ChartDataPoint[];
}

/**
 * #1472: an ALL-TIME aggregate is shown only when it is actually all-time. `complete` comes from the full history
 * (≤ 20 sessions, every row loaded) or a successful server summary; anything else is `loading` or `unavailable`, never a
 * window silently presented as all-time. `OverallStats` exists only inside `complete`.
 */
export type AllTimeUnavailableReason =
  | 'session_count_unavailable'
  | 'history_failed'
  | 'history_incomplete'
  | 'summary_failed'
  | 'summary_refetch_failed';
export type AllTimeAggregate =
  | { status: 'complete'; stats: OverallStats }
  | { status: 'loading' }
  | { status: 'unavailable'; reason: AllTimeUnavailableReason };

/** #1472: this-week counts, complete only when the data actually covers the week (see useAnalytics). */
export type WeeklyActivityDay = { day: string; sessions: number };
export type WeeklyAggregate =
  | { status: 'complete'; count: number; activity: WeeklyActivityDay[] }
  | { status: 'loading' }
  | { status: 'unavailable' };

export interface AnalyticsSummary {
  overallStats: OverallStats;
  fillerWordTrends: FillerWordTrends;
  topFillerWords: { word: string; count: number }[];
  weeklySessionsCount: number;
  weeklyActivity: { day: string; sessions: number }[];
}
