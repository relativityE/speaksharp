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
import { readFileSync, readdirSync } from 'node:fs';

const PROJECT = 'tsconfig.live.json';

/** Files that MUST be in scope — the canonical production proof and the helper it depends on. */
const REQUIRED = [
    'tests/live/three-session-retention-proof.live.spec.ts',
    'tests/live/private-recording-proof.live.spec.ts',
    'tests/live/helpers/runOwnedCleanup.ts',
    // Compile-only sentinel: the only thing exercising the `@shared` alias, so a mapping break is
    // detectable. If it silently drops out of scope, that falsification goes dark.
    'tests/live/helpers/sharedAliasSentinel.ts',
];

/**
 * EVERY root live spec must be covered, not a chosen subset. Scoping to the two #1306 proofs would
 * have hidden the four real signature-drift defects that live in OTHER live specs — the precise rot
 * this gate exists to catch. Compared against the specs actually on disk so adding one cannot silently
 * leave it unchecked.
 */
const LIVE_SPEC_DIR = 'tests/live';

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

/**
 * The single exception to the edge-source rule. The `@shared` alias sentinel imports this module in a
 * TYPE position so the mapping is falsifiable at all; without it, breaking `@shared/*` changed nothing
 * and the claim "the alias resolves" was untestable.
 *
 * The invariant the FORBIDDEN rule actually protects is "nothing that needs Deno globals", not "no
 * backend file ever" — so the exception is verified rather than trusted: this module must contain no
 * reference to `Deno`, checked below. A broad path ban with no exception would have forced deleting
 * the sentinel and losing the falsification.
 */
const EDGE_SOURCE_EXCEPTIONS = [
    'backend/supabase/functions/_shared/constants.ts',   // @shared alias sentinel
    'backend/supabase/functions/_shared/test-fixtures.ts', // imported through the live spec graph
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

// Every *.live.spec.ts on disk must be in the resolved set.
const onDisk = readdirSync(LIVE_SPEC_DIR).filter((f) => f.endsWith('.live.spec.ts'));
if (onDisk.length === 0) fail('found no live specs on disk — the comparison would be vacuous');
const uncovered = onDisk.filter((spec) => !files.some((f) => f.endsWith(`${LIVE_SPEC_DIR}/${spec}`)));
if (uncovered.length > 0) {
    fail(`${uncovered.length} root live spec(s) are OUT of scope: ${uncovered.join(', ')}`);
}

for (const { fragment, why } of FORBIDDEN) {
    const hits = files.filter((f) => f.includes(fragment))
        .filter((f) => !EDGE_SOURCE_EXCEPTIONS.some((allowed) => f.endsWith(allowed)));
    if (hits.length > 0) fail(`forbidden path in scope (${why}): ${fragment}`);
}

// Verify the exception rather than trusting it: an "allowed" edge module that starts using Deno
// globals would silently reintroduce exactly what the rule forbids.
for (const allowed of EDGE_SOURCE_EXCEPTIONS) {
    if (!files.some((f) => f.endsWith(allowed))) continue;   // not pulled in; nothing to verify
    const source = readFileSync(allowed, 'utf8');
    if (/\bDeno\b/.test(source)) fail(`edge-source exception now references Deno: ${allowed}`);
}

// Counts and path classes only.
const classes = {
    live_specs: local.filter((f) => f.startsWith('tests/live/') && f.endsWith('.live.spec.ts')).length,
    live_helpers: local.filter((f) => f.startsWith('tests/live/helpers/')).length,
    shared_test_helpers: local.filter((f) => f.startsWith('tests/helpers/')).length,
    frontend_src: local.filter((f) => f.startsWith('frontend/src/')).length,
};
console.log(`live-typecheck-scope OK local_files=${local.length} ${Object.entries(classes).map(([k, v]) => `${k}=${v}`).join(' ')}`);
