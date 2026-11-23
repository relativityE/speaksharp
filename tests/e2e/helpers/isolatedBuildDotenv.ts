/**
 * J7.c isolated build (option B): the dotenv files the build could still read.
 *
 * `frontend/vite.config.mjs` calls `loadEnv(mode, <repo root>, '')` itself, independent of the `envDir` the isolated build
 * passes to Vite. For a given mode, Vite's `loadEnv` reads exactly `.env`, `.env.local`, `.env.<mode>` and
 * `.env.<mode>.local` from that directory. The isolated build promises no dotenv reads, so it refuses to start while any of
 * them exists. This checks existence only: it never opens, reads or prints a file.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The repo-root files `loadEnv(mode, repoRoot, '')` reads for `mode`. */
export function rootDotenvFiles(mode: string): string[] {
    if (!/^[a-z][a-z0-9-]*$/.test(mode)) throw new Error('isolated build: unexpected Vite mode');
    return ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
}

/** Throws, naming only the file names, if any dotenv file the build's own config would read exists under `repoRoot`. */
export function assertNoRootDotenv(repoRoot: string, mode: string): void {
    const present = rootDotenvFiles(mode).filter((name) => existsSync(join(repoRoot, name)));
    if (present.length > 0) {
        throw new Error(`isolated build refused: ${present.join(', ')} present at the repo root; vite.config.mjs would read it`);
    }
}
