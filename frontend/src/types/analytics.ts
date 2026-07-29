export interface FillerWordTrends {
  [key: string]: {
    current: number;
    previous: number;
  };
}

export interface ChartDataPoint {
  date: string;
  'FW/min': string | number;
  clarity: number;
  [key: string]: string | number;
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

export interface AnalyticsSummary {
  overallStats: OverallStats;
  fillerWordTrends: FillerWordTrends;
  topFillerWords: { word: string; count: number }[];
  accuracyData: { date: string; accuracy: number; engine: string }[];
  weeklySessionsCount: number;
  weeklyActivity: { day: string; sessions: number }[];
}
