#!/usr/bin/env node
// Bounded, verified installer for the pinned Supabase CLI used by the disposable database-proof workflow
// (.github/workflows/account-closure-full-chain-proof.yml).
//
// Why: `supabase/setup-cli@v2` downloads with no deadline. On run 44645972965 (job 135988517462, head de9464d5) its
// "Setup Supabase CLI" substep ran 29m51s and was cancelled at the 30-minute job limit; the same substep took 2.8 s on the
// rerun. The logs locate the stall inside CLI setup but do not prove which upstream request hung. This installer bounds
// that step instead: every attempt has a total deadline and a no-progress (stall) deadline; only a transient failure
// (stall, deadline, network error, HTTP 429/5xx) is retried, a bounded number of times; anything else fails at once. The
// download must match the pinned SHA-256 and the binary must report the pinned version. If it cannot, the step fails
// explicitly and no database proof runs.
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SUPABASE_CLI = Object.freeze({
    version: '2.101.0',
    url: 'https://github.com/supabase/cli/releases/download/v2.101.0/supabase_linux_amd64.tar.gz',
    // From the release's checksums.txt and the GitHub asset digest (both agree), 2026-11-20.
    sha256: '285877ef9de845d76487772e0d36019a095ee28b527b9abbd6739eeba4d3dbf9',
});
export const DEFAULT_LIMITS = Object.freeze({ attempts: 3, attemptTimeoutMs: 120_000, stallTimeoutMs: 30_000, backoffMs: 3_000 });

export class InstallError extends Error {
    constructor(message, { transient }) { super(message); this.transient = transient; }
}

/** One download attempt: resolves the bytes, or rejects with an InstallError marked transient or not. */
export async function downloadOnce(url, { attemptTimeoutMs, stallTimeoutMs, fetchImpl = fetch }) {
    const controller = new AbortController();
    let reason = null;
    const abort = (why) => { if (!reason) { reason = why; controller.abort(); } };
    const total = setTimeout(() => abort(`attempt exceeded ${attemptTimeoutMs} ms`), attemptTimeoutMs);
    let stall = setTimeout(() => abort(`no bytes for ${stallTimeoutMs} ms`), stallTimeoutMs);
    const progress = () => { clearTimeout(stall); stall = setTimeout(() => abort(`no bytes for ${stallTimeoutMs} ms`), stallTimeoutMs); };
    try {
        const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
        progress();
        if (response.status === 429 || response.status >= 500) throw new InstallError(`HTTP ${response.status}`, { transient: true });
        if (!response.ok || !response.body) throw new InstallError(`HTTP ${response.status}`, { transient: false });
        const chunks = [];
        for await (const chunk of response.body) { chunks.push(Buffer.from(chunk)); progress(); }
        return Buffer.concat(chunks);
    } catch (error) {
        if (error instanceof InstallError) throw error;
        // An abort we triggered (stall or deadline) or a network failure: transient.
        throw new InstallError(reason ? `download stalled: ${reason}` : `download failed: ${error?.message ?? error}`, { transient: true });
    } finally {
        clearTimeout(total);
        clearTimeout(stall);
        // Leaving the attempt for any reason (including an HTTP error whose body is still streaming or stalled) cancels the
        // request, so nothing left open can keep the process, and the workflow step, waiting (Codex P2). A no-op once the
        // body has been read in full.
        controller.abort();
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Download (bounded, retried only when transient), verify the pinned digest, extract, and verify the reported version.
 * Returns the directory that holds `supabase`. Throws an InstallError when the CLI cannot be installed exactly.
 */
export async function installSupabaseCli({ url = SUPABASE_CLI.url, sha256 = SUPABASE_CLI.sha256, version = SUPABASE_CLI.version,
    destDir = mkdtempSync(join(tmpdir(), 'supabase-cli-')), limits = DEFAULT_LIMITS, fetchImpl = fetch, log = () => undefined } = {}) {
    let bytes = null;
    for (let attempt = 1; attempt <= limits.attempts; attempt++) {
        const started = Date.now();
        try {
            bytes = await downloadOnce(url, { ...limits, fetchImpl });
            log(`attempt ${attempt}: downloaded ${bytes.length} bytes in ${Date.now() - started} ms`);
            break;
        } catch (error) {
            log(`attempt ${attempt}: ${error.message} after ${Date.now() - started} ms`);
            if (!error.transient || attempt === limits.attempts) {
                throw new InstallError(`Supabase CLI ${version} not installed after ${attempt} attempt(s): ${error.message}`, { transient: false });
            }
            await sleep(limits.backoffMs * attempt);
        }
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== sha256) throw new InstallError(`Supabase CLI download digest ${digest} does not match the pinned ${sha256}`, { transient: false });
    mkdirSync(destDir, { recursive: true });
    const archive = join(destDir, 'supabase.tar.gz');
    writeFileSync(archive, bytes);
    // The whole archive, as setup-cli extracts it: `supabase` may hand some commands to the bundled `supabase-go`.
    execFileSync('tar', ['-xzf', archive, '-C', destDir], { stdio: 'pipe', timeout: 60_000 });
    rmSync(archive, { force: true });
    const binary = join(destDir, 'supabase');
    if (!existsSync(binary)) throw new InstallError('the archive held no supabase binary', { transient: false });
    chmodSync(binary, 0o755);
    const reported = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim();
    if (reported !== version) throw new InstallError(`installed CLI reports ${JSON.stringify(reported)}, pinned ${version}`, { transient: false });
    return destDir;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const started = Date.now();
    try {
        const dir = await installSupabaseCli({ log: (line) => console.log(`[supabase-cli] ${line}`) });
        if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, `${dir}\n`);
        console.log(`[supabase-cli] installed ${SUPABASE_CLI.version} (sha256 verified) in ${Date.now() - started} ms at ${dir}`);
    } catch (error) {
        console.log(`::error::${error.message}`);
        process.exit(1);
    }
}
