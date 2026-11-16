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
