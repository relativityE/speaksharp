#!/usr/bin/env node
/**
 * MVP single-owner worktree leases (#1125).
 *
 * RULE: a linked git worktree has ONE writable owner until explicit release. Never edit/checkout/reset/
 * clean/rebase/format/commit/push in another owner's worktree. Review a pushed SHA from a SEPARATE
 * worktree. A handoff transfers a clean pushed commit — not a directory.
 *
 * This tool registers an ALREADY-CREATED **current** worktree. It never creates, switches, removes,
 * prunes, resets, cleans, deletes, or force-pushes worktrees/branches, and it only ever acts on the
 * caller's own current worktree (no arbitrary path targeting). Missing/corrupt/conflicting state fails
 * closed; there is no automatic stale takeover.
 *
 * Commands (operate on the CURRENT worktree only):
 *   claim   --agent <id> --task <issue>   Atomically lease the current worktree + its branch for <id>.
 *   assert-owner --agent <id>             Mutation preflight: fail closed unless path, branch, marker, and
 *                                         registry all name <id>. (Detached HEAD fails closed.)
 *   status  [--json]                      Read-only sanitized lease + branch/base/head + dirty + upstream.
 *   handoff --agent <id>                  Require owner + clean + HEAD==pushed upstream; print a text
 *                                         handoff manifest. Does NOT release or mutate ownership.
 *   release --agent <id>                  Require owner + clean/pushed; remove ONLY this lease/marker and
 *                                         the worktree prune-lock. Never deletes a branch or worktree.
 *
 * Exit codes: 0 = ok · 1 = ownership/state violation · 2 = usage error.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REGISTRY_DIRNAME = 'agent-worktrees';
const MARKER_NAME = '.agent-owner.json';
const LOCK_TIMEOUT_MS = 5000;

class OwnershipError extends Error {}

function git(args, cwd) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitQuiet(args, cwd) {
    try { return git(args, cwd); } catch { return null; }
}

function resolveContext(cwd) {
    let worktreeRoot;
    try {
        worktreeRoot = git(['rev-parse', '--show-toplevel'], cwd);
    } catch {
        throw new OwnershipError(`not inside a git worktree: ${cwd}`);
    }
    const commonDir = path.resolve(worktreeRoot, git(['rev-parse', '--git-common-dir'], worktreeRoot));
    // Detached HEAD → no symbolic branch → branch is null (ownership fails closed downstream).
    const branch = gitQuiet(['symbolic-ref', '--quiet', '--short', 'HEAD'], worktreeRoot);
    const headSha = gitQuiet(['rev-parse', 'HEAD'], worktreeRoot);
    return { worktreeRoot, commonDir, branch, headSha };
}

function registryPaths(commonDir) {
    const dir = path.join(commonDir, REGISTRY_DIRNAME);
    return { dir, lock: path.join(dir, '.lock'), file: path.join(dir, 'leases.json') };
}

/** Synchronous sleep without a spin loop. */
function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Serialize concurrent writers via an atomic mkdir lock under the shared common dir. */
function withLock(commonDir, fn) {
    const { dir, lock } = registryPaths(commonDir);
    mkdirSync(dir, { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
        try { mkdirSync(lock); break; }
        catch (e) {
            if (e.code !== 'EEXIST') throw e;
            if (Date.now() > deadline) throw new OwnershipError('could not acquire lease-registry lock (held by another process)');
            sleepMs(50);
        }
    }
    try { return fn(); } finally { try { rmSync(lock, { recursive: true, force: true }); } catch { /* best effort */ } }
}

/** Fail closed on a missing or corrupt registry — it is part of the collision-prevention authority. */
function readLeases(file) {
    if (!existsSync(file)) return [];
    let raw;
    try { raw = readFileSync(file, 'utf8'); } catch (e) { throw new OwnershipError(`cannot read lease registry: ${e.message}`); }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new OwnershipError('lease registry is malformed JSON — refusing to proceed (fail closed)'); }
    if (!parsed || !Array.isArray(parsed.leases)) throw new OwnershipError('lease registry has no leases[] array — refusing to proceed (fail closed)');
    return parsed.leases;
}

/** Atomic write: sibling temp file + rename, so a crash never leaves the authority file truncated. */
function writeLeases(file, leases) {
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, leases }, null, 2)}\n`);
    renameSync(tmp, file);
}

function markerPath(worktreeRoot) { return path.join(worktreeRoot, MARKER_NAME); }

function readMarker(worktreeRoot) {
    const p = markerPath(worktreeRoot);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { throw new OwnershipError('owner marker is malformed JSON (fail closed)'); }
}

/** Persistent project storage only — never an OS temp path (a temp lease is not durable governance). */
function assertPersistentPath(worktreeRoot) {
    if (process.env.AGENT_WORKTREE_ALLOW_TMP === '1') return; // isolated-temp-repo tests only
    // Resolve symlinks so macOS's /var/folders (real /private/var/folders) is detected, not missed.
    const real = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
    const tmp = real(os.tmpdir());
    const resolved = real(worktreeRoot);
    if (resolved === tmp || resolved.startsWith(tmp + path.sep) || resolved.startsWith('/tmp/') || resolved.startsWith('/private/tmp/')) {
        throw new OwnershipError(`refusing to govern an OS-temp worktree path (${worktreeRoot}); use persistent project storage`);
    }
}

function requireAgent(agent, command) {
    if (!agent) throw new OwnershipError(`${command} requires an agent identity (--agent or SS_AGENT)`);
    return agent;
}

function nowIso() { return new Date().toISOString(); }

function isClean(worktreeRoot) {
    return git(['status', '--porcelain'], worktreeRoot) === '';
}

/** { hasUpstream, matchesUpstream } — a handoff transfers a pushed commit, so HEAD must equal upstream. */
function upstreamState(worktreeRoot) {
    const upstream = gitQuiet(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], worktreeRoot);
    if (!upstream) return { hasUpstream: false, matchesUpstream: false, upstream: null };
    const local = gitQuiet(['rev-parse', 'HEAD'], worktreeRoot);
    const remote = gitQuiet(['rev-parse', '@{upstream}'], worktreeRoot);
    return { hasUpstream: true, matchesUpstream: Boolean(local && remote && local === remote), upstream, local, remote };
}

// ── commands ────────────────────────────────────────────────────────────────

function cmdClaim({ agent, task, cwd }) {
    requireAgent(agent, 'claim');
    if (!task) throw new OwnershipError('claim requires --task <issue>');
    const ctx = resolveContext(cwd);
    assertPersistentPath(ctx.worktreeRoot);
    if (!ctx.branch) throw new OwnershipError('claim requires a checked-out branch (HEAD is detached)');
    return withLock(ctx.commonDir, () => {
        const { file } = registryPaths(ctx.commonDir);
        const leases = readLeases(file);
        for (const l of leases) {
            if (l.worktreePath === ctx.worktreeRoot && l.agent !== agent) {
                throw new OwnershipError(`worktree already owned by '${l.agent}' (task ${l.task}); release first`);
            }
            if (l.branch === ctx.branch && l.agent !== agent) {
                throw new OwnershipError(`branch '${ctx.branch}' already writable by '${l.agent}'; one writer per branch`);
            }
        }
        const rest = leases.filter((l) => l.worktreePath !== ctx.worktreeRoot);
        const lease = {
            agent, task: String(task), worktreePath: ctx.worktreeRoot, branch: ctx.branch,
            baseSha: ctx.headSha, createdAt: nowIso(),
        };
        rest.push(lease);
        writeLeases(file, rest);
        writeFileSync(markerPath(ctx.worktreeRoot), `${JSON.stringify(lease, null, 2)}\n`);
        // Lock the worktree against pruning (anti-prune only; never creates/removes/switches).
        gitQuiet(['worktree', 'lock', ctx.worktreeRoot], ctx.worktreeRoot);
        return `claimed ${ctx.worktreeRoot} (branch ${ctx.branch}) for ${agent}`;
    });
}

function cmdAssertOwner({ agent, cwd }) {
    requireAgent(agent, 'assert-owner');
    const ctx = resolveContext(cwd);
    if (!ctx.branch) throw new OwnershipError('HEAD is detached — no owned branch to prove (fail closed)');
    const marker = readMarker(ctx.worktreeRoot);
    if (!marker) throw new OwnershipError(`no owner marker in ${ctx.worktreeRoot}; claim it before mutating`);
    if (marker.agent !== agent) throw new OwnershipError(`worktree owned by '${marker.agent}', not '${agent}'`);
    if (marker.branch !== ctx.branch) throw new OwnershipError(`checked-out branch '${ctx.branch}' is not the owned branch '${marker.branch}'`);
    const { file } = registryPaths(ctx.commonDir);
    const lease = readLeases(file).find((l) => l.worktreePath === ctx.worktreeRoot);
    if (!lease) throw new OwnershipError(`no registry lease for ${ctx.worktreeRoot}; marker is orphaned`);
    if (lease.agent !== agent) throw new OwnershipError(`registry lease owned by '${lease.agent}', not '${agent}'`);
    if (lease.branch !== ctx.branch) throw new OwnershipError(`registry lease branch '${lease.branch}' is not the current branch '${ctx.branch}'`);
    return `owner confirmed: ${agent} @ ${ctx.worktreeRoot} (${ctx.branch})`;
}

function cmdHandoff({ agent, cwd }) {
    requireAgent(agent, 'handoff');
    const ctx = resolveContext(cwd);
    if (!ctx.branch) throw new OwnershipError('HEAD is detached — cannot hand off (fail closed)');
    const { file } = registryPaths(ctx.commonDir);
    const lease = readLeases(file).find((l) => l.worktreePath === ctx.worktreeRoot);
    if (!lease) throw new OwnershipError(`no lease for ${ctx.worktreeRoot}`);
    if (lease.agent !== agent) throw new OwnershipError(`only the current owner '${lease.agent}' may hand off`);
    if (!isClean(ctx.worktreeRoot)) throw new OwnershipError('working tree is dirty — commit or discard before handoff');
    const up = upstreamState(ctx.worktreeRoot);
    if (!up.hasUpstream) throw new OwnershipError('branch has no upstream — push it before handoff');
    if (!up.matchesUpstream) throw new OwnershipError('HEAD does not equal the pushed upstream — push before handoff');
    // Manifest ONLY — ownership is NOT mutated. The recipient claims a DIFFERENT worktree at this SHA.
    const manifest = {
        handoff: true, from: agent, worktreePath: ctx.worktreeRoot, branch: ctx.branch,
        headSha: ctx.headSha, upstream: up.upstream, task: lease.task, at: nowIso(),
        note: 'Recipient: create/claim your OWN worktree and review this pushed SHA. Ownership unchanged until the current owner runs `release`.',
    };
    return JSON.stringify(manifest, null, 2);
}

function cmdRelease({ agent, cwd }) {
    requireAgent(agent, 'release');
    const ctx = resolveContext(cwd);
    return withLock(ctx.commonDir, () => {
        const { file } = registryPaths(ctx.commonDir);
        const leases = readLeases(file);
        const lease = leases.find((l) => l.worktreePath === ctx.worktreeRoot);
        if (!lease) throw new OwnershipError(`no lease for ${ctx.worktreeRoot}`);
        if (lease.agent !== agent) throw new OwnershipError(`only the owner '${lease.agent}' may release, not '${agent}'`);
        if (!isClean(ctx.worktreeRoot)) throw new OwnershipError('working tree is dirty — commit/discard before release');
        const up = upstreamState(ctx.worktreeRoot);
        if (!(up.hasUpstream && up.matchesUpstream)) throw new OwnershipError('HEAD is not pushed to its upstream — push before release');
        writeLeases(file, leases.filter((l) => l.worktreePath !== ctx.worktreeRoot));
        const mp = markerPath(ctx.worktreeRoot);
        if (existsSync(mp)) unlinkSync(mp);
        gitQuiet(['worktree', 'unlock', ctx.worktreeRoot], ctx.worktreeRoot); // unlock prune-lock; never removes the worktree
        return `released ${ctx.worktreeRoot} (was ${lease.agent}); branch + worktree left intact`;
    });
}

function cmdStatus({ cwd, json }) {
    const ctx = resolveContext(cwd);
    const { file } = registryPaths(ctx.commonDir);
    const leases = readLeases(file);
    const marker = readMarker(ctx.worktreeRoot);
    const up = upstreamState(ctx.worktreeRoot);
    const dirty = !isClean(ctx.worktreeRoot);
    const view = {
        worktree: ctx.worktreeRoot, branch: ctx.branch, head: ctx.headSha,
        owner: marker ? { agent: marker.agent, task: marker.task, baseSha: marker.baseSha } : null,
        dirty, upstream: up.upstream, upstreamMatches: up.matchesUpstream,
        leases: leases.map((l) => ({ agent: l.agent, task: l.task, branch: l.branch, worktreePath: l.worktreePath })),
    };
    if (json) return JSON.stringify(view, null, 2);
    const lines = [
        `worktree: ${view.worktree}`, `branch:   ${view.branch ?? '(detached)'}`, `head:     ${view.head}`,
        `owner:    ${marker ? `${marker.agent} (task ${marker.task})` : '(unclaimed)'}`,
        `dirty:    ${dirty}`, `upstream: ${up.upstream ?? '(none)'}  matches=${up.matchesUpstream}`,
        `leases (${leases.length}):`,
    ];
    for (const l of leases) lines.push(`  - ${l.agent}  ${l.branch}  ${l.worktreePath}  [task ${l.task}]`);
    return lines.join('\n');
}

// ── arg parsing + dispatch ────────────────────────────────────────────────────

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        if (key === 'json') { out.json = true; continue; }
        out[key] = argv[++i];
    }
    return out;
}

function main() {
    const [command, ...rest] = process.argv.slice(2);
    const args = parseArgs(rest);
    const cwd = process.cwd(); // current worktree only — no arbitrary --path targeting
    const agent = args.agent || process.env.SS_AGENT || null;
    try {
        let result;
        switch (command) {
            case 'claim': result = cmdClaim({ agent, task: args.task, cwd }); break;
            case 'assert-owner': result = cmdAssertOwner({ agent, cwd }); break;
            case 'handoff': result = cmdHandoff({ agent, cwd }); break;
            case 'release': result = cmdRelease({ agent, cwd }); break;
            case 'status': result = cmdStatus({ cwd, json: args.json }); break;
            default:
                process.stderr.write('usage: agent-worktree <claim|assert-owner|status|handoff|release> --agent <id> [--task <issue>] [--json]\n');
                process.exit(2);
        }
        process.stdout.write(`${result}\n`);
        process.exit(0);
    } catch (e) {
        process.stderr.write(`agent-worktree ${command}: ${e.message}\n`);
        process.exit(e instanceof OwnershipError ? 1 : 2);
    }
}

main();
