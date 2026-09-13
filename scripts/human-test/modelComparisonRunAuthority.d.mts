// #1432 PM decisions 5651684739 / 5651830241 / 5651842972 — types for the GitHub run authorization authority.
// The live project compiles with `allowJs: false`; declared beside the module.
export declare const RUN_AUTHORIZATION_VERSION: string;
export declare const AUTHORIZATION_WORKFLOW_PATH: string;
export declare const AUTHORIZATION_FILE_NAME: string;
export declare const MODEL_COMPARISON_REPOSITORY: string;
export declare const PRODUCTION_ORIGIN: string;
export declare const CLOCK_SKEW_MS: number;
export declare const AUTHORIZATION_JOB_NAME: string;
export declare const DIAGNOSTIC_JOB_NAME: string;
export declare const COMPARISON_CELLS: readonly string[];
export declare const AUTHORIZATION_KEYS: readonly string[];
export declare const RECORD_KEYS: readonly string[];
export type RunAuthorityPhase = 'terminal' | 'in_run';

export interface RunAuthorization {
    schemaVersion: string;
    repository: string;
    workflowPath: string;
    workflowRef: string;
    workflowSha: string;
    runId: number;
    runAttempt: number;
    actor: string;
    releaseSha: string;
    origin: string;
    candidateId: string;
    journey: string;
    evidenceDocumentId: string;
    nonce: string;
    issuedAt: string;
}
export interface RunAuthorityBundle {
    repo: unknown;
    run: unknown;
    jobs: unknown;
    artifact: unknown;
}
export type GithubGet = (path: string) => Promise<unknown>;
export type RunArtifactFetcher = (runId: number, runAttempt: number) => Promise<unknown>;

export declare function authorizationArtifactName(runAttempt: number): string;
export declare function parseComparisonCell(cell: unknown): { candidateId: string; journey: string } | null;
export declare function mintRunAuthorization(input: Record<string, unknown>): RunAuthorization;
export declare function authorizationShapeProblems(value: unknown, keys?: readonly string[]): string[];
export declare function checkRunAuthority(input: {
    record: unknown;
    artifact: unknown;
    repo: unknown;
    run: unknown;
    jobs: unknown;
    expected?: Record<string, unknown>;
    at: number;
    phase?: RunAuthorityPhase;
}): string[];
export declare function loadRunAuthority(input: {
    runId: number;
    runAttempt: number;
    githubGet: GithubGet;
    fetchRunArtifact: RunArtifactFetcher;
    repository?: string;
}): Promise<RunAuthorityBundle>;
export declare function verifyRunAuthorization(input: {
    runId: number;
    runAttempt: number;
    githubGet: GithubGet;
    fetchRunArtifact: RunArtifactFetcher;
    expected?: Record<string, unknown>;
    now?: number;
}): Promise<{ ok: boolean; problems: string[]; record: (RunAuthorization & { verifiedAt: string }) | null }>;
export declare function githubApiGetter(options?: { token?: string | null; fetchImpl?: typeof fetch; apiBase?: string }): GithubGet;
export declare function ghCliGetter(execFile: (...args: unknown[]) => unknown, gh?: string): GithubGet;
export declare function ghRunArtifactFetcher(execFile: (...args: unknown[]) => unknown, gh?: string, repository?: string): RunArtifactFetcher;
