/**
 * #1532 Codex P1 r4126003354 (PM RETURN 5876635920) — WHERE A PRIVATE FILE MAY EXIST, EVEN BRIEFLY.
 *
 * A file holding Production content (the exported session PDF carries the saved transcript) must never be written
 * under a path any rc-gates.yml upload step collects (`test-results/`, `playwright-report/`, `blob-report/`, named
 * files under `runner.temp`). Deleting it in `finally` is not the boundary: a killed or timed-out run skips `finally`,
 * and the always-run diagnostic upload still ships `test-results/`. So the file lives in a fresh per-run directory
 * under the runner's temp root (`RUNNER_TEMP` in Actions; the OS temp directory locally), which no step uploads, and
 * is removed with its directory afterwards.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TransientPrivateDir {
    dir: string;
    file: (name: string) => string;
    remove: () => void;
}

export function transientPrivateDir(label: string, env: NodeJS.ProcessEnv = process.env): TransientPrivateDir {
    const root = env.RUNNER_TEMP || os.tmpdir();
    const dir = mkdtempSync(path.join(root, `rwt-private-${label}-`));
    return {
        dir,
        file: (name) => path.join(dir, path.basename(name)),
        remove: () => rmSync(dir, { recursive: true, force: true }),
    };
}
