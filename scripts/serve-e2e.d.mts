/** Types for serve-e2e.mjs, which stays plain ESM because `pnpm serve:e2e` runs it directly. */
import type { RequestListener, Server } from 'node:http';

export interface E2eApp extends RequestListener {
    listen(port: number, host: string, callback?: () => void): Server;
}
export function createE2eApp(distDir?: string): E2eApp;
