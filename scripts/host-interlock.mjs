#!/usr/bin/env node
/**
 * CLI guard for the host interlock, wrapped around heavy local commands so the refusal is mechanical.
 *
 *   node scripts/host-interlock.mjs hold local -- <cmd...>
 *   node scripts/host-interlock.mjs check local
 *
 * THE LOCK OUTLIVES THE SIGNAL. On SIGINT/SIGTERM/SIGHUP the signal is FORWARDED to the child and the
 * lock is kept until the child actually exits. Releasing on the signal and exiting immediately left the
 * child running as an orphan with no lock at all — a benchmark starting next would see a clear host
 * while a full test suite was still burning CPU.
 *
 * NESTED COMMANDS DO NOT RE-ACQUIRE. `test:full` chains quality -> unit -> build -> e2e; each is itself
 * guarded, so the outermost holds and the inner ones inherit via SPEAKSHARP_INTERLOCK_HELD. Without
 * this the first inner command's release would drop the lock for the rest of the chain.
 */
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { acquire, assertClear, heldByAncestor, InterlockError } from './lib/hostInterlock.mjs';

const [, , mode, kind, ...rest] = process.argv;
const argv = rest[0] === '--' ? rest.slice(1) : rest;

const fail = (e) => {
    if (e instanceof InterlockError) { console.error(`\n${e.message}\n`); process.exit(3); }
    throw e;
};

if (mode === 'check') {
    try { assertClear(kind); process.exit(0); } catch (e) { fail(e); }
} else if (mode === 'hold') {
    if (!argv.length) { console.error('hold requires: -- <command...>'); process.exit(2); }
    let held;
    try { held = acquire(kind); } catch (e) { fail(e); }

    const child = spawn(argv[0], argv.slice(1), {
        stdio: 'inherit',
        shell: false,
        // Own process group, so a forwarded signal reaches the whole workload tree rather than only the
        // immediate child — a test runner's own workers must not survive as unprotected orphans.
        detached: true,
        // Descendants inherit the protection and must not take (or drop) a lock of their own.
        env: { ...process.env, SPEAKSHARP_INTERLOCK_HELD: heldByAncestor() ? process.env.SPEAKSHARP_INTERLOCK_HELD : String(process.pid) },
    });

    // Liveness now tracks the CHILD. A SIGKILLed wrapper leaves a lock whose workload is still alive,
    // so it keeps blocking instead of being reclaimed as stale.
    if (child.pid) held.adopt?.(child.pid);

    let releasing = false;
    const releaseOnce = () => { if (!releasing) { releasing = true; held.release(); } };

    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(sig, () => {
            // Forward and WAIT. The lock is released by the exit handler below, once the child is gone.
            try { process.kill(-child.pid, sig); } catch {
                try { child.kill(sig); } catch { /* already gone */ }
            }
        });
    }
    child.on('exit', (code, signal) => {
        releaseOnce();
        process.exit(signal ? 128 + (osConstants.signals[signal] ?? 15) : (code ?? 1));
    });
    child.on('error', (e) => { releaseOnce(); console.error(String(e)); process.exit(1); });
    // Last-resort net for an abrupt exit that skips the handlers above.
    process.on('exit', releaseOnce);
} else {
    console.error('usage: host-interlock.mjs <check|hold> <benchmark|local> [-- cmd...]');
    process.exit(2);
}
