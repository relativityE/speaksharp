#!/usr/bin/env node
/**
 * CLI guard for the host interlock. Wrapped around local test/build entry points so the refusal is
 * mechanical rather than remembered.
 *
 *   node scripts/host-interlock.mjs check local        # refuse if a benchmark is running
 *   node scripts/host-interlock.mjs hold local -- <cmd...>   # hold the lock for the child's lifetime
 */
import { spawn } from 'node:child_process';
import { acquire, assertClear, InterlockError } from './lib/hostInterlock.mjs';

const [, , mode, kind, ...rest] = process.argv;
const argv = rest[0] === '--' ? rest.slice(1) : rest;

try {
    if (mode === 'check') {
        assertClear(kind);
        process.exit(0);
    }
    if (mode === 'hold') {
        const held = acquire(kind);
        const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', shell: false });
        const release = () => held.release();
        process.on('exit', release);
        for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
            process.on(sig, () => { release(); process.exit(130); });
        }
        child.on('exit', (code) => { release(); process.exit(code ?? 1); });
        child.on('error', (e) => { release(); console.error(String(e)); process.exit(1); });
    } else {
        console.error('usage: host-interlock.mjs <check|hold> <benchmark|local> [-- cmd...]');
        process.exit(2);
    }
} catch (e) {
    if (e instanceof InterlockError) { console.error(`\n${e.message}\n`); process.exit(3); }
    throw e;
}
