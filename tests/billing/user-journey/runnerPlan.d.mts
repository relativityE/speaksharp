export type RunnerPlanMode = 'smoke' | 'full';
export const MODES: RunnerPlanMode[];
export const STRIPE_WRITE_ALLOWLIST: string[];
export type Reader = (path: string) => string | null;
export const PREREQUISITES: Record<string, { what: string; check: (read: Reader) => boolean }>;
export type Phase = {
  id: string; kind: 'browser_branch' | 'external_spec'; modes: RunnerPlanMode[]; config: string; grep: string;
  requires: string[]; steps: readonly string[]; pendingPolicySteps: readonly string[]; stripeWrites: string[];
  testCards: string[]; events: string[]; proves: string; runtimeNeeds?: string[];
};
export const PHASES: Phase[];
export const OPEN_QUESTIONS: string[];
export function readRepoFile(path: string): string | null;
export function workflowDispatch(read: Reader): { options: string[]; configs: Record<string, boolean> };
export type PlannedPhase = {
  id: string; kind: Phase['kind']; status: 'READY' | 'BLOCKED_PREREQUISITE';
  blockedBy: { prerequisite: string; what: string }[];
  dispatch: { workflow: string; journey: string; config: string; grep: string; env: { BILLING_RUNNER_MODE: string } };
  pendingPolicySteps: readonly string[]; stripeWrites: string[]; testCards: string[]; events: string[];
  proves: string; runtimeNeeds: string[];
};
export function planRun(mode: string, read?: Reader): {
  schema: 'billing-runner-plan/v1'; mode: RunnerPlanMode; dryRun: true; stripeCalls: 0; authorizesExecution: false;
  result: 'READY' | 'READY_WITH_PENDING_POLICY' | 'BLOCKED_PREREQUISITE'; phases: PlannedPhase[]; openQuestions: string[];
};
export const EXTERNAL_REQUIRED_STEPS: Readonly<Record<string, readonly string[]>>;
export type ModeEvidence = { phase: string; combined?: unknown; rawReceipt?: string; destruction?: unknown };
export function finaliseModeReceipt(mode: string, entries: unknown, expected?: { release?: string }): {
  schema: 'billing-runner-mode/v2'; mode: RunnerPlanMode; release: string | null; problems: string[];
  phases: { phase: string; result: 'PASSED' | 'PENDING_POLICY' | 'NOT_PROVEN'; why: string[] }[];
  result: 'PASSED' | 'PENDING_POLICY' | 'NOT_PROVEN';
};
