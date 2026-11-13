/** Types for runtime-bindings.mjs, which stays plain ESM because Vite's config and node tests load it directly. */
export interface RuntimeBindingFile { path: string; bytes: number; sha256: string }
export interface RuntimeBinding { package: string; version: string; parent?: string; files: RuntimeBindingFile[] }
export interface RuntimeBindingInventory { schemaVersion: 1; bindings: RuntimeBinding[] }
export interface VerifiedRuntime { package: string; version: string; verifiedFiles: number }
export function verifyInstalledRuntimes(root: string, inventory: RuntimeBindingInventory): Promise<VerifiedRuntime[]>;
export function verifyProjectRuntimeBindings(root: string): Promise<VerifiedRuntime[]>;
export function runtimeBindingsPlugin(root?: string): { name: string; buildStart(): Promise<void> };
