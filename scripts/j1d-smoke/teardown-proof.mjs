#!/usr/bin/env node
// J1.d smoke: write the CHECKED teardown proof for this run's disposable stack (scripts/j1d-smoke/stack.sh down).
//   node scripts/j1d-smoke/teardown-proof.mjs <state-dir> <supabase-stop-exit>
// Reads <state-dir>/identity.json (recorded after `supabase start`), asks Docker for every recorded container, volume and network,
// re-reads the stack's label selectors, binds the result to this commit and run attempt, and writes <state-dir>/destroyed.json.
// Exits 1 unless the stack is proven destroyed.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildTeardownProof, smokeBinding } from './smokeEvidence.mjs';

const KINDS = [['containers', 'container'], ['volumes', 'volume'], ['networks', 'network']];

/** `docker` is injectable: (args) => { status, output }. Docker's own absence answers: "No such …" or "network … not found". */
export function teardownChecks(identity, docker) {
    const checks = [];
    for (const [field, kind] of KINDS) {
        for (const id of identity[field]) {
            const r = docker([kind, 'inspect', id]);
            checks.push({ kind, id, absent: r.status !== 0 && /no such|not found/i.test(r.output) });
        }
    }
    const label = `label=com.supabase.cli.project=${identity.project}`;
    const count = (args) => { const r = docker(args); return r.status === 0 ? r.output.split('\n').filter(Boolean).length : Number.POSITIVE_INFINITY; };
    const remaining = { containers: count(['ps', '-aq', '--filter', label]), volumes: count(['volume', 'ls', '-q', '--filter', label]),
        networks: count(['network', 'ls', '-q', '--filter', label]) };
    return { checks, remaining };
}

export function writeTeardownProof(state, stopExit, { env = process.env, docker, commit } = {}) {
    const identityText = readFileSync(join(state, 'identity.json'), 'utf8');
    const identity = JSON.parse(identityText);
    const { checks, remaining } = teardownChecks(identity, docker);
    const proof = buildTeardownProof({ binding: smokeBinding(env, commit), identity, identityText, checks, remaining, stopExit });
    writeFileSync(join(state, 'destroyed.json'), `${JSON.stringify(proof, null, 2)}\n`);
    return proof;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const [state, stopExitRaw] = process.argv.slice(2);
    const stopExit = /^\d+$/.test(stopExitRaw ?? '') ? Number(stopExitRaw) : -1;
    const docker = (args) => { const r = spawnSync('docker', args, { encoding: 'utf8' }); return { status: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const proof = writeTeardownProof(state, stopExit, { docker, commit });
    console.log(JSON.stringify({ project: proof.project, recorded: proof.recorded, left: proof.left, destroyed: proof.destroyed }));
    if (!proof.destroyed) { console.log('the disposable stack was NOT proven destroyed'); process.exit(1); }
}
