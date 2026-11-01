export declare const PROMOTION_POLICY_SCHEMA: 'speaksharp.model-promotion-policy.v1';
export interface PromotionPolicy {
  schema: typeof PROMOTION_POLICY_SCHEMA;
  incumbent: string;
  maxWerRegression: number;
  maxStopToCompletionRatio: number;
  approvedBy: string;
}
export interface QualificationDecision {
  qualification: 'PASS' | 'HOLD';
  qualifiedPackages: string[];
  reasons: string[];
  candidates: Record<string, { verdict: 'PASS' | 'HOLD'; packageDigest: string | null; reasons: string[] }>;
  policy?: Omit<PromotionPolicy, never>;
}
export interface TimingMetric { status: 'MEASURED' | 'NOT RUN'; samples: number; median: number | null }
export declare function validatePromotionPolicy(policy: unknown): PromotionPolicy;
export declare function validTiming(value: unknown): value is number;
export declare function timingMetric(values: readonly unknown[]): TimingMetric;
export declare function qualifyComparison(input: {
  summary: unknown;
  rows: readonly unknown[];
  candidates: readonly string[];
  policy: PromotionPolicy | null;
  /** SHA-256 of the exact policy bytes read before any take. */
  policySha256?: string | null;
  /** The policy digest bound in the independently approved execution packet. */
  expectedPolicySha256?: string | null;
  /** The verified campaign package seal per candidate id. */
  expectedPackages?: Readonly<Record<string, string | null>>;
  /** Every expected `trial:clip` key; each candidate must cover it exactly once. */
  population?: readonly string[];
}): QualificationDecision;
