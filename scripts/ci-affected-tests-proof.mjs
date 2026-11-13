#!/usr/bin/env node
/**
 * Proof for the draft-lane affected-test selector (scripts/lib/affectedTestSelection.mjs). Manual; not run in CI.
 *
 *   node scripts/ci-affected-tests-proof.mjs trace <dir> [--jobs 3]
 *     Runs every unit test file on its own under strace and records, per test file, every repository path its
 *     processes opened, executed, probed or listed (child processes included). Resumable. Needs strace (Linux).
 *   node scripts/ci-affected-tests-proof.mjs check <dir>
 *     For EVERY tracked file a draft-lane change could touch, checks that the selector picks every test whose
 *     traced run read, executed or probed that file. Selection is a union over changed files, so a file-by-file
 *     pass covers any combination of changed files. Exits 1 and lists each miss if any test would be skipped.
 *
 * Ground truth is what the tests did on this checkout. A test that reads a file only on some branch of its code
 * that this run did not take is not covered, so rerun the trace after test changes that add new reads.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, normalize, relative, resolve } from 'node:path';
import { classifyChanges } from './ci-change-scope.mjs';
import { buildTestIndex, selectAffectedTests } from './lib/affectedTestSelection.mjs';

const root = process.cwd();
const [command, dirArg, ...rest] = process.argv.slice(2);
if (!['trace', 'check'].includes(command) || !dirArg) {
    console.error('usage: node scripts/ci-affected-tests-proof.mjs trace|check <dir> [--jobs N]');
    process.exit(2);
}
const dir = resolve(dirArg);
mkdirSync(dir, { recursive: true });
const local = (path) => relative(root, path).split('\\').join('/');
const inRepo = (path) => path && !path.startsWith('..') && !path.startsWith('/') && !path.split('/').includes('node_modules') && !path.startsWith('.git/');

async function withVitest(fn) {
    const { createVitest } = await import('vitest/node');
    const vitest = await createVitest('test', { config: 'frontend/vitest.config.mjs', watch: false, run: true, coverage: { enabled: false } });
    try { return await fn(vitest); } finally { await vitest.close(); }
}

// One strace line: `<pid> <syscall>(<args>) = <result>`. Records repository paths only.
function summarise(traceText, test) {
    const reads = new Set(), probes = new Set(), lists = new Set(), execs = new Set();
    for (const line of traceText.split('\n')) {
        const m = /^\d+\s+(\w+)\((.*)$/.exec(line);
        if (!m) continue;
        const [, call, args] = m;
        const quoted = /"((?:[^"\\]|\\.)*)"/.exec(args);
        if (!quoted) continue;
        const path = local(normalize(quoted[1].startsWith('/') ? quoted[1] : join(root, quoted[1])));
        if (!inRepo(path)) continue;
        const failed = /= -1 /.test(args);
        if (call === 'openat') (args.includes('O_DIRECTORY') ? lists : failed ? probes : reads).add(path);
        else if (call === 'execve') execs.add(path);
        else if (call === 'getdents64') lists.add(path);
        else probes.add(path);
    }
    for (const path of reads) probes.delete(path);
    return { test, reads: [...reads].sort(), probes: [...probes].sort(), lists: [...lists].sort(), execs: [...execs].sort() };
}

async function trace() {
    const jobs = Number(rest[rest.indexOf('--jobs') + 1]) || 3;
    const tests = await withVitest(async (vitest) => (await vitest.specifications.globTestSpecifications()).map((spec) => local(spec.moduleId)));
    const pending = tests.filter((test) => !existsSync(join(dir, `${createHash('sha1').update(test).digest('hex').slice(0, 16)}.json`)));
    console.log(`${tests.length} test files, ${pending.length} to trace, ${jobs} at a time.`);
    let done = 0;
    const runOne = (test) => new Promise((resolveRun) => {
        const id = createHash('sha1').update(test).digest('hex').slice(0, 16);
        const raw = join(dir, `${id}.strace`);
        const child = spawn('strace', ['-f', '-qq', '-s', '4096', '-e', 'trace=openat,execve,getdents64,newfstatat,statx,access,faccessat2', '-o', raw,
            process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--config', 'frontend/vitest.config.mjs', '--coverage.enabled=false', test],
        { cwd: root, stdio: 'ignore', env: { ...process.env, NODE_OPTIONS: '' } });
        child.on('close', (code) => {
            const summary = { ...summarise(readFileSync(raw, 'utf8'), test), exitCode: code };
            writeFileSync(join(dir, `${id}.json`), JSON.stringify(summary));
            rmSync(raw, { force: true });
            if (++done % 25 === 0 || done === pending.length) console.log(`  traced ${done}/${pending.length}`);
            resolveRun();
        });
    });
    const queue = [...pending];
    await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await runOne(queue.shift()); }));
}

async function check() {
    const traces = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
    const { specs, triggers } = await withVitest(async (vitest) => {
        const out = [];
        for (const spec of await vitest.specifications.globTestSpecifications()) {
            out.push({ file: local(spec.moduleId), deps: [...await vitest.specifications.getTestDependencies(spec)].map(local).filter(inRepo) });
        }
        const wholeSuite = new Set();
        for (const project of vitest.projects) {
            for (const setupFile of project.config.setupFiles || []) {
                wholeSuite.add(local(setupFile));
                for (const dep of await vitest.specifications.getTestDependencies({ project, moduleId: setupFile })) if (inRepo(local(dep))) wholeSuite.add(local(dep));
            }
        }
        return { specs: out, triggers: wholeSuite };
    });
    const traced = new Set(traces.map((t) => t.test));
    const untraced = specs.filter(({ file }) => !traced.has(file)).map(({ file }) => file);
    // Paths nearly every run probes are Vitest resolving and globbing, not one test's dependency.
    const probeCount = new Map();
    for (const t of traces) for (const p of t.probes) probeCount.set(p, (probeCount.get(p) || 0) + 1);
    const runnerNoise = new Set([...probeCount].filter(([, c]) => c >= 0.9 * traces.length).map(([p]) => p));
    const needs = new Map();
    for (const t of traces) {
        for (const p of [...t.reads, ...t.execs, ...t.probes.filter((p) => !runnerNoise.has(p))]) {
            if (!needs.has(p)) needs.set(p, new Set());
            needs.get(p).add(t.test);
        }
    }
    const readText = (path) => { try { return readFileSync(join(root, path), 'utf8'); } catch { return null; } };
    const index = buildTestIndex({ specs, readText });
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    const misses = [];
    let eligible = 0, wholeSuite = 0;
    for (const file of tracked) {
        if (classifyChanges([file], { isDraft: true }).full_required) continue; // never reaches the draft lane
        eligible++;
        const result = selectAffectedTests({ changed: [file], index, wholeSuiteTriggers: triggers });
        if (result.full) { wholeSuite++; continue; }
        const missed = [...(needs.get(file) || [])].filter((test) => !result.selected.has(test));
        if (missed.length) misses.push({ file, missed });
    }
    console.log(`Traced ${traces.length} of ${specs.length} test files (${traces.filter((t) => t.exitCode !== 0).length} exited non-zero).`);
    if (untraced.length) console.log(`Not traced: ${untraced.length} (${untraced.slice(0, 5).join(', ')}${untraced.length > 5 ? ', ...' : ''}).`);
    console.log(`Checked ${eligible} tracked files a draft-lane change can touch; ${wholeSuite} select the whole suite.`);
    if (misses.length || untraced.length) {
        for (const { file, missed } of misses.slice(0, 50)) console.log(`MISS ${file}: ${missed.join(', ')}`);
        console.log(`${misses.length} file(s) with a test the selector would skip.`);
        process.exit(1);
    }
    console.log('No traced dependency is missed: for every one of those files, every test that read, ran or probed it is selected.');
}

await (command === 'trace' ? trace() : check());
