#!/usr/bin/env node
// #1339 — non-vacuous scope control for the live-proof TypeScript gate.
//
// A typecheck that resolves ZERO files exits 0. So does one whose include set silently stopped
// matching the production proof after a rename or a move. Either way the gate would report green while
// checking nothing — the same shape of false assurance as the vacuous CI green that merged #1306.
//
// This asserts, BEFORE tsc runs, that the project actually resolves the surface it claims to protect.
// Output is counts and path classes only: no secrets, no production identifiers.
import { execFileSync } from 'node:child_process';

const PROJECT = 'tsconfig.live.json';

/** Files that MUST be in scope — the canonical production proof and the helper it depends on. */
const REQUIRED = [
    'tests/live/three-session-retention-proof.live.spec.ts',
    'tests/live/private-recording-proof.live.spec.ts',
    'tests/live/helpers/runOwnedCleanup.ts',
];

/**
 * Path fragments that must NOT be in scope. Deno edge sources need a different lib/global set, so
 * pulling them in would force weakening this project's strictness to reach green — and a gate that was
 * loosened to pass is not a gate. Generated worktrees and package stores must never be globbed either.
 */
const FORBIDDEN = [
    { fragment: 'backend/supabase/functions/', why: 'Deno edge sources (different lib/global set)' },
    { fragment: 'test-support/', why: 'generated worktrees / package store' },
    { fragment: '/node_modules/tests/', why: 'vendored test copies' },
];

function fail(message) {
    console.error(`live-typecheck-scope: ${message}`);
    process.exit(1);
}

let listed;
try {
    listed = execFileSync('npx', ['tsc', '--noEmit', '--listFilesOnly', '-p', PROJECT], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
} catch (err) {
    // A type ERROR still lists files; only a config/invocation failure lands here without output.
    listed = String(err.stdout ?? '');
    if (!listed.trim()) fail(`could not resolve project ${PROJECT} (config error)`);
}

const cwd = process.cwd();
const files = listed.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((f) => (f.startsWith(cwd) ? f.slice(cwd.length + 1) : f));

const local = files.filter((f) => !f.includes('node_modules'));
if (local.length === 0) fail('resolved ZERO local files — the gate would pass while checking nothing');

for (const required of REQUIRED) {
    if (!files.some((f) => f.endsWith(required))) {
        fail(`required file is OUT of scope: ${required} — the include set no longer covers the production proof`);
    }
}

for (const { fragment, why } of FORBIDDEN) {
    const hit = files.find((f) => f.includes(fragment));
    if (hit) fail(`forbidden path in scope (${why}): ${fragment}`);
}

// Counts and path classes only.
const classes = {
    live_specs: local.filter((f) => f.startsWith('tests/live/') && f.endsWith('.live.spec.ts')).length,
    live_helpers: local.filter((f) => f.startsWith('tests/live/helpers/')).length,
    shared_test_helpers: local.filter((f) => f.startsWith('tests/helpers/')).length,
    frontend_src: local.filter((f) => f.startsWith('frontend/src/')).length,
};
console.log(`live-typecheck-scope OK local_files=${local.length} ${Object.entries(classes).map(([k, v]) => `${k}=${v}`).join(' ')}`);
