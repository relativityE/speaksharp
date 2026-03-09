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
  averageWPM: number;
  avgFillerWordsPerMin: string | number;
  avgAccuracy: string | number;
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
