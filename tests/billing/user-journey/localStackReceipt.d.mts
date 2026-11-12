export declare const PENDING: 'PENDING_STACK_DESTRUCTION';
export declare const RECEIPT_KEYS: readonly string[];
export interface LocalStackChecks { stackStopped?: string; stackDestroyed?: string; stripeClean?: string }
export interface LocalStackExpected { journey?: string; release?: string; stackRun?: string; receiptSha256?: string; destruction?: unknown }
export interface CombinedLocalStackReceipt {
  schema: 'billing-local-stack-combined/v2';
  journey: string | null;
  release: string | null;
  stackRun: string | null;
  rawReceiptSha256: string | null;
  journeyReceipt: 'PENDING_STACK_DESTRUCTION' | 'NOT_PROVEN';
  stackStopped: 'PASSED' | 'NOT_PROVEN';
  stackDestroyed: 'PASSED' | 'NOT_PROVEN';
  stripeFixturesRemoved: 'PASSED' | 'NOT_PROVEN';
  billingRowResidue: 'NOT_READ_DATABASE_DESTROYED' | 'NOT_READ_NOT_PROVEN';
  defects: string[];
  result: 'PASSED' | 'NOT_PROVEN';
}
export declare function journeyReceiptDefects(receipt: unknown, expected: LocalStackExpected): string[];
export declare function destructionDefects(destruction: unknown, stackRun: string | null | undefined): string[];
export declare function finaliseLocalStackReceipt(journeyReceipts: unknown, checks: LocalStackChecks, expected?: LocalStackExpected): CombinedLocalStackReceipt;
