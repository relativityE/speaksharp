#!/usr/bin/env node
/**
 * Single-owner worktree governance.
 *
 * RULE: a worktree has exactly one owning agent for its entire lifetime. No other agent may enter it or
 * switch its branch. Reviews and handoffs happen through pushed SHAs, never through a shared directory.
 *
 * Ownership is recorded two ways, both consulted fail-closed:
 *  1. An ATOMIC lease registry under Git's COMMON dir (`<git-common-dir>/agent-worktrees/leases.json`),
 *     shared across every worktree of the repo — so a second worktree cannot claim the same directory or
 *     the same writable branch.
 *  2. A per-worktree owner marker (`<worktree>/.agent-owner.json`) recording agent, issue, branch, base
 *     SHA, and creation time.
 *
 * This tool NEVER runs reset/checkout/clean/rebase/push/branch-delete. It only reads git and writes the
 * registry + marker. Guards (assert-owner) are FAIL-CLOSED: when an agent identity is present
 * (SS_AGENT env or --agent), a mutation is blocked unless ownership is proven for the current worktree
 * AND its checked-out branch.
 *
 * Commands:
 *   claim        --agent A --issue N --branch B [--path P]   Atomically lease worktree P + branch B for A.
 *   assert-owner [--agent A] [--path P]                      Exit 0 iff A owns worktree P and HEAD == owned branch.
 *   status       [--json] [--path P]                         Show this worktree's owner + all leases.
 *   handoff      --to A2 [--agent A] [--path P]              Transfer worktree P (+its branch) from A to A2.
 *   release      [--agent A] [--path P]                      Remove the lease + marker for worktree P (owner only).
 *
 * Exit codes: 0 = ok · 1 = ownership violation / conflict · 2 = usage error.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REGISTRY_DIRNAME = 'agent-worktrees';
const MARKER_NAME = '.agent-owner.json';
const LOCK_TIMEOUT_MS = 5000;

class OwnershipError extends Error {}

function git(args, cwd) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function resolveContext(cwd) {
    let worktreeRoot;
    try {
        worktreeRoot = git(['rev-parse', '--show-toplevel'], cwd);
    } catch {
        throw new OwnershipError(`not inside a git worktree: ${cwd}`);
    }
    const commonDir = path.resolve(worktreeRoot, git(['rev-parse', '--git-common-dir'], worktreeRoot));
    let branch = null;
    try { branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], worktreeRoot); } catch { branch = null; }
    let headSha = null;
    try { headSha = git(['rev-parse', 'HEAD'], worktreeRoot); } catch { headSha = null; }
    return { worktreeRoot, commonDir, branch, headSha };
}

function registryPaths(commonDir) {
    const dir = path.join(commonDir, REGISTRY_DIRNAME);
    return { dir, lock: path.join(dir, '.lock'), file: path.join(dir, 'leases.json') };
}

/** Sleep synchronously without a spin loop (safe in a plain Node CLI). */
function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Atomic critical section over the shared registry via mkdir (atomic create, fails if held). */
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

function readLeases(file) {
    if (!existsSync(file)) return [];
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return Array.isArray(parsed.leases) ? parsed.leases : [];
    } catch {
        return [];
    }
}

function writeLeases(file, leases) {
    writeFileSync(file, `${JSON.stringify({ version: 1, leases }, null, 2)}\n`);
}

function markerPath(worktreeRoot) { return path.join(worktreeRoot, MARKER_NAME); }

function readMarker(worktreeRoot) {
    const p = markerPath(worktreeRoot);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** Persistent worktree paths only — a lease inside a temp dir is not durable governance. */
function assertPersistentPath(worktreeRoot) {
    if (process.env.AGENT_WORKTREE_ALLOW_TMP === '1') return; // isolated-temp-repo tests only
    const tmp = path.resolve(os.tmpdir());
    const resolved = path.resolve(worktreeRoot);
    if (resolved === tmp || resolved.startsWith(tmp + path.sep) || resolved.startsWith('/tmp/') || resolved.startsWith('/private/tmp/')) {
        throw new OwnershipError(`refusing to govern a temporary worktree path (${worktreeRoot}); use a persistent worktree`);
    }
}

function nowIso() { return new Date().toISOString(); }

// ── commands ────────────────────────────────────────────────────────────────

function cmdClaim({ agent, issue, branch, cwd }) {
    if (!agent) throw new OwnershipError('claim requires --agent (or SS_AGENT)');
    if (!issue) throw new OwnershipError('claim requires --issue');
    const ctx = resolveContext(cwd);
    assertPersistentPath(ctx.worktreeRoot);
    const wantBranch = branch || ctx.branch;
    if (!wantBranch) throw new OwnershipError('claim requires --branch (HEAD is detached)');
    if (ctx.branch && wantBranch !== ctx.branch) {
        throw new OwnershipError(`--branch ${wantBranch} does not match the worktree's checked-out branch ${ctx.branch}`);
    }
    return withLock(ctx.commonDir, () => {
        const { file } = registryPaths(ctx.commonDir);
        const leases = readLeases(file);
        for (const l of leases) {
            if (l.worktreePath === ctx.worktreeRoot && l.agent !== agent) {
                throw new OwnershipError(`worktree already owned by '${l.agent}' (issue ${l.issue}); handoff or release first`);
            }
            if (l.branch === wantBranch && l.agent !== agent) {
                throw new OwnershipError(`branch '${wantBranch}' already writable by '${l.agent}'; one writer per branch`);
            }
        }
        const rest = leases.filter((l) => l.worktreePath !== ctx.worktreeRoot);
        const lease = {
            agent, issue: String(issue), branch: wantBranch, worktreePath: ctx.worktreeRoot,
            baseSha: ctx.headSha, createdAt: nowIso(),
        };
        rest.push(lease);
        writeLeases(file, rest);
        writeFileSync(markerPath(ctx.worktreeRoot), `${JSON.stringify(lease, null, 2)}\n`);
        return `claimed ${ctx.worktreeRoot} (branch ${wantBranch}) for ${agent}`;
    });
}

function cmdAssertOwner({ agent, cwd }) {
    if (!agent) throw new OwnershipError('assert-owner requires an agent identity (--agent or SS_AGENT)');
    const ctx = resolveContext(cwd);
    const marker = readMarker(ctx.worktreeRoot);
    if (!marker) throw new OwnershipError(`no owner marker in ${ctx.worktreeRoot}; claim it before mutating`);
    if (marker.agent !== agent) throw new OwnershipError(`worktree owned by '${marker.agent}', not '${agent}'`);
    if (ctx.branch && marker.branch !== ctx.branch) {
        throw new OwnershipError(`checked-out branch '${ctx.branch}' is not the owned branch '${marker.branch}'`);
    }
    const { file } = registryPaths(ctx.commonDir);
    const lease = readLeases(file).find((l) => l.worktreePath === ctx.worktreeRoot);
    if (!lease) throw new OwnershipError(`no registry lease for ${ctx.worktreeRoot}; marker is orphaned`);
    if (lease.agent !== agent) throw new OwnershipError(`registry lease owned by '${lease.agent}', not '${agent}'`);
    if (lease.branch !== marker.branch) throw new OwnershipError('registry lease branch disagrees with marker');
    return `owner confirmed: ${agent} @ ${ctx.worktreeRoot} (${marker.branch})`;
}

function cmdHandoff({ agent, to, cwd }) {
    if (!to) throw new OwnershipError('handoff requires --to <agent>');
    const ctx = resolveContext(cwd);
    return withLock(ctx.commonDir, () => {
        const { file } = registryPaths(ctx.commonDir);
        const leases = readLeases(file);
        const lease = leases.find((l) => l.worktreePath === ctx.worktreeRoot);
        if (!lease) throw new OwnershipError(`no lease for ${ctx.worktreeRoot}`);
        const from = agent || lease.agent;
        if (lease.agent !== from) throw new OwnershipError(`only the current owner '${lease.agent}' may hand off`);
        lease.agent = to;
        lease.handoffAt = nowIso();
        lease.handoffFrom = from;
        writeLeases(file, leases);
        const marker = readMarker(ctx.worktreeRoot) || lease;
        marker.agent = to; marker.handoffAt = lease.handoffAt; marker.handoffFrom = from;
        writeFileSync(markerPath(ctx.worktreeRoot), `${JSON.stringify(marker, null, 2)}\n`);
        return `handed off ${ctx.worktreeRoot} from ${from} to ${to}`;
    });
}

function cmdRelease({ agent, cwd }) {
    const ctx = resolveContext(cwd);
    return withLock(ctx.commonDir, () => {
        const { file } = registryPaths(ctx.commonDir);
        const leases = readLeases(file);
        const lease = leases.find((l) => l.worktreePath === ctx.worktreeRoot);
        if (!lease) throw new OwnershipError(`no lease for ${ctx.worktreeRoot}`);
        if (agent && lease.agent !== agent) throw new OwnershipError(`only the owner '${lease.agent}' may release`);
        writeLeases(file, leases.filter((l) => l.worktreePath !== ctx.worktreeRoot));
        const mp = markerPath(ctx.worktreeRoot);
        if (existsSync(mp)) unlinkSync(mp);
        return `released ${ctx.worktreeRoot} (was ${lease.agent})`;
    });
}

function cmdStatus({ cwd, json }) {
    const ctx = resolveContext(cwd);
    const { file } = registryPaths(ctx.commonDir);
    const leases = readLeases(file);
    const marker = readMarker(ctx.worktreeRoot);
    if (json) return JSON.stringify({ worktree: ctx.worktreeRoot, branch: ctx.branch, marker, leases }, null, 2);
    const lines = [`worktree: ${ctx.worktreeRoot}`, `branch:   ${ctx.branch ?? '(detached)'}`,
        `owner:    ${marker ? `${marker.agent} (issue ${marker.issue})` : '(unclaimed)'}`, `leases (${leases.length}):`];
    for (const l of leases) lines.push(`  - ${l.agent}  ${l.branch}  ${l.worktreePath}  [issue ${l.issue}]`);
    return lines.join('\n');
}

// ── arg parsing + dispatch ────────────────────────────────────────────────────

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            if (key === 'json') { out.json = true; continue; }
            out[key] = argv[++i];
        } else out._.push(a);
    }
    return out;
}

function main() {
    const [command, ...rest] = process.argv.slice(2);
    const args = parseArgs(rest);
    const cwd = args.path ? path.resolve(args.path) : process.cwd();
    const agent = args.agent || process.env.SS_AGENT || null;
    try {
        let result;
        switch (command) {
            case 'claim': result = cmdClaim({ agent, issue: args.issue, branch: args.branch, cwd }); break;
            case 'assert-owner': result = cmdAssertOwner({ agent, cwd }); break;
            case 'handoff': result = cmdHandoff({ agent, to: args.to, cwd }); break;
            case 'release': result = cmdRelease({ agent, cwd }); break;
            case 'status': result = cmdStatus({ cwd, json: args.json }); break;
            default:
                process.stderr.write('usage: agent-worktree <claim|assert-owner|status|handoff|release> [options]\n');
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
