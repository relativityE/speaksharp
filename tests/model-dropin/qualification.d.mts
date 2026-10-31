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
export declare function validatePromotionPolicy(policy: unknown): PromotionPolicy;
export declare function qualifyComparison(input: {
  summary: unknown;
  rows: readonly unknown[];
  candidates: readonly string[];
  policy: PromotionPolicy | null;
}): QualificationDecision;
