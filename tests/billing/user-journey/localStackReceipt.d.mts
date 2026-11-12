export declare const PENDING: 'PENDING_STACK_DESTRUCTION';
export interface LocalStackChecks { stackStopped?: string; stackDestroyed?: string; stripeClean?: string }
export interface CombinedLocalStackReceipt {
  schema: 'billing-local-stack-combined/v1';
  journey: string | null;
  journeyReceipt: 'PENDING_STACK_DESTRUCTION' | 'NOT_PROVEN';
  stackStopped: 'PASSED' | 'NOT_PROVEN';
  stackDestroyed: 'PASSED' | 'NOT_PROVEN';
  stripeFixturesRemoved: 'PASSED' | 'NOT_PROVEN';
  billingRowResidue: 'NOT_READ_DATABASE_DESTROYED' | 'NOT_READ_NOT_PROVEN';
  result: 'PASSED' | 'NOT_PROVEN';
}
export declare function finaliseLocalStackReceipt(journeyReceipts: unknown, checks: LocalStackChecks): CombinedLocalStackReceipt;
