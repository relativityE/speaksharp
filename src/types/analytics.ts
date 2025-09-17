export interface TrendData {
  count: number;
  severity: 'red' | 'orange' | 'yellow' | 'green';
  tooltip: string;
}

export interface FillerWordTrends {
  [key: string]: TrendData[];
}
