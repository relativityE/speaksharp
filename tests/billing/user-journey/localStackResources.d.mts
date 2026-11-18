export declare const IDENTITY_SCHEMA: 'billing-local-stack-identity/v1';
export declare const DESTROYED_SCHEMA: 'billing-local-stack-destroyed/v2';
export declare const PROJECT_PATTERN: RegExp;
export interface DockerAnswer { code: number; stdout: string; stderr: string }
export type DockerRunner = (args: string[]) => DockerAnswer;
export declare class StackProofError extends Error { code: string }
export interface StackIdentity {
  schema: 'billing-local-stack-identity/v1'; project: string;
  database: { container: string; volume: string; systemIdentifier: string };
  containers: string[]; volumes: string[]; networks: string[];
}
export interface StackDestroyed {
  schema: 'billing-local-stack-destroyed/v2'; project: string; databaseSystemIdentifier: string; identitySha256: string;
  containers: number; volumes: number; networks: number; destroyed: true;
}
export declare function runDocker(args: string[]): DockerAnswer;
export declare function captureStackIdentity(project: string, docker?: DockerRunner): StackIdentity;
export declare function assertIdentityShape(identity: unknown, project: string): void;
export declare function stackIdentitySha256(identity: unknown, project: string): string;
export declare function verifyStackDestroyed(identity: unknown, project: string, docker?: DockerRunner): StackDestroyed;
export declare const WITNESS_SCHEMA: 'billing-local-stack-cleanup-witness/v2';
export declare const OWNER_BINDING_SCHEMA: 'billing-owner-binding/v1';
export declare const AUTH_REFUSED_REASON: 'account_cleanup_deleteuser_failed';
export interface OwnerBinding { schema: 'billing-owner-binding/v1'; stackRun: string; ownerBindingSha256: string }
export interface WitnessEvidence { receiptText: string | null; receiptSha256: string; binding: unknown; journey: string; release: string }
export interface CleanupWitness {
  schema: 'billing-local-stack-cleanup-witness/v2'; receipt: 'this_run'; owner: 'bound'; database: 'recorded';
  counts: { obligation: Record<string, number>; lease: Record<string, number>; session: Record<string, number> };
  supportingLogPhraseLines: Record<string, number>; logScope: 'container_lifetime_not_attempt_scoped';
}
export declare function ownerBindingRecord(project: string, marker: string): OwnerBinding;
export declare function runDockerFull(args: string[]): DockerAnswer;
export declare function witnessCleanupRefusal(evidence: unknown, identity: unknown, project: string, docker?: DockerRunner): CleanupWitness;
