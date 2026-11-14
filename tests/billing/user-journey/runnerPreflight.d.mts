export declare class PreflightError extends Error { code: string }
export declare const LOCAL_API_ORIGINS: readonly string[];
export declare function fingerprint(value: unknown): string;
type Env = Record<string, string | undefined>;
export declare function assertTestKeys(env: Env): void;
export declare function assertKeysMatchStack(env: Env): void;
export declare function assertLocalSupabaseKeys(env: Env): string;
export declare function probeLocalBackend(origin: string, anonKey: string | undefined,
  fetchImpl: (url: string, init?: RequestInit) => Promise<{ status: number }>): Promise<void>;
export declare function runnerPreflight(env: Env,
  fetchImpl?: (url: string, init?: RequestInit) => Promise<{ status: number }>): Promise<{
  api: string; keyClass: 'test'; keysMatchStack: true; backend: 'loopback' }>;
