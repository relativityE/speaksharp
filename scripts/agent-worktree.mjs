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
 * caller's own current worktree (no arbitrary path targeting). Missing/corrupt/conflicting/incomplete
 * state fails closed; there is no automatic stale takeover and no silent repair.
 *
 * Commands (operate on the CURRENT worktree only):
 *   claim   --agent <id> --task <issue>   Atomically lease the current worktree + its branch for <id>.
 *   assert-owner --agent <id>             Mutation preflight: fail closed unless path, branch, marker, and
 *                                         registry all name <id>. (Detached HEAD fails closed.)
 *   status  [--json]                      Read-only sanitized lease + branch/base/head + dirty + upstream.
 *   handoff --agent <id>                  Require full ownership + clean + HEAD==pushed upstream; print a
 *                                         text handoff manifest. Does NOT release or mutate ownership.
 *   release --agent <id>                  Require full ownership + clean/pushed; remove ONLY this lease and
 *                                         marker (+ prune-lock). Never deletes a branch or worktree.
 *
 * Exit codes: 0 = ok · 1 = ownership/state violation · 2 = usage error.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REGISTRY_DIRNAME = 'agent-worktrees';
const MARKER_NAME = 'agent-owner.json'; // stored under the worktree's Git admin dir, never the working tree
const SENTINEL_NAME = '.initialized';
const LOCK_TIMEOUT_MS = 5000;
// The prune-lock reason this tool stamps on the worktree. Release only unlocks a lock carrying THIS exact
// reason, so a foreign/manual `git worktree lock` is never adopted or silently removed.
const LOCK_REASON = 'agent-worktree single-owner lease';
// Every authoritative lease field. The registry requires all as non-empty strings, and a marker must
// match its lease on ALL of them (tamper/consistency check) before assert/handoff/release/idempotent reclaim.
const LEASE_STRING_FIELDS = ['agent', 'task', 'worktreePath', 'branch', 'baseSha', 'createdAt'];

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
    // Per-worktree PRIVATE admin dir (e.g. .git/worktrees/<id>) — the marker lives here, never in the tree.
    const gitDir = git(['rev-parse', '--absolute-git-dir'], worktreeRoot);
    // Detached HEAD → no symbolic branch → branch is null (ownership fails closed downstream).
    const branch = gitQuiet(['symbolic-ref', '--quiet', '--short', 'HEAD'], worktreeRoot);
    const headSha = gitQuiet(['rev-parse', 'HEAD'], worktreeRoot);
    return { worktreeRoot, commonDir, gitDir, branch, headSha };
}

function registryPaths(commonDir) {
    const dir = path.join(commonDir, REGISTRY_DIRNAME);
    return { dir, lock: path.join(dir, '.lock'), file: path.join(dir, 'leases.json'), sentinel: path.join(dir, SENTINEL_NAME) };
}

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

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

/**
 * Read + VALIDATE the registry. Parsing an array is not enough authority: the version, every lease's
 * required fields/types, and path/branch uniqueness are all checked. Any violation — malformed JSON, a
 * bad record, a duplicate, or a registry file that was initialized and then DISAPPEARED — fails closed.
 */
function readLeases(commonDir) {
    const { file, sentinel } = registryPaths(commonDir);
    if (!existsSync(file)) {
        if (existsSync(sentinel)) throw new OwnershipError('lease registry file is missing though the registry was initialized — refusing to proceed (fail closed)');
        return []; // genuine first run
    }
    let parsed;
    try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
    catch { throw new OwnershipError('lease registry is malformed JSON — refusing to proceed (fail closed)'); }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.leases)) {
        throw new OwnershipError('lease registry has an unexpected shape (version/leases) — refusing to proceed (fail closed)');
    }
    const seenPath = new Set();
    const seenBranch = new Set();
    for (const l of parsed.leases) {
        if (!l || typeof l !== 'object') throw new OwnershipError('lease registry contains a non-object record (fail closed)');
        for (const f of LEASE_STRING_FIELDS) {
            if (typeof l[f] !== 'string' || l[f].trim() === '') throw new OwnershipError(`lease registry record missing/invalid '${f}' (fail closed)`);
        }
        if (seenPath.has(l.worktreePath)) throw new OwnershipError(`lease registry has duplicate worktree '${l.worktreePath}' (fail closed)`);
        if (seenBranch.has(l.branch)) throw new OwnershipError(`lease registry has duplicate branch '${l.branch}' (fail closed)`);
        seenPath.add(l.worktreePath);
        seenBranch.add(l.branch);
    }
    return parsed.leases;
}

/** Atomic write: sibling temp file + rename; also drop the initialized sentinel so a later disappearance is detectable. */
function writeLeases(commonDir, leases) {
    const { dir, file, sentinel } = registryPaths(commonDir);
    mkdirSync(dir, { recursive: true });
    // Sentinel BEFORE the registry rename: a crash mid-write still leaves a durable initialization mark,
    // so a subsequent disappearance of leases.json is never mistaken for a genuine first run.
    if (!existsSync(sentinel)) writeFileSync(sentinel, `initialized ${new Date().toISOString()}\n`);
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, leases }, null, 2)}\n`);
    renameSync(tmp, file);
}

function markerPath(gitDir) { return path.join(gitDir, MARKER_NAME); }

/** Read the marker; a malformed marker fails closed (never silently repaired). null = absent. */
function readMarker(gitDir) {
    const p = markerPath(gitDir);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')); }
    catch { throw new OwnershipError('owner marker is malformed JSON — refusing to proceed (fail closed)'); }
}

/** Persistent project storage only — never an OS temp path (a temp lease is not durable governance). */
function assertPersistentPath(worktreeRoot) {
    if (process.env.AGENT_WORKTREE_ALLOW_TMP === '1') return; // isolated-temp-repo tests only
    const real = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
    const tmp = real(os.tmpdir());
    const resolved = real(worktreeRoot);
    if (resolved === tmp || resolved.startsWith(tmp + path.sep) || resolved.startsWith('/tmp/') || resolved.startsWith('/private/tmp/')) {
        throw new OwnershipError(`refusing to govern an OS-temp worktree path (${worktreeRoot}); use persistent project storage`);
    }
}

function requireAgent(agent, command) {
    if (!agent || String(agent).trim() === '') throw new OwnershipError(`${command} requires a non-blank agent identity (--agent or SS_AGENT)`);
    return agent;
}
function nowIso() { return new Date().toISOString(); }
function isClean(worktreeRoot) { return git(['status', '--porcelain'], worktreeRoot) === ''; }

function upstreamState(worktreeRoot) {
    // A branch can track ANOTHER LOCAL branch (the '.' remote); `@{upstream}` still resolves and can equal
    // HEAD, which would falsely report a pushed state even though no remote has the commit. Require the
    // upstream to be a real remote-tracking ref (refs/remotes/…) before treating it as "pushed".
    const fullRef = gitQuiet(['rev-parse', '--symbolic-full-name', '@{upstream}'], worktreeRoot);
    if (!fullRef) return { hasUpstream: false, matchesUpstream: false, upstream: null };
    if (!fullRef.startsWith('refs/remotes/')) {
        return { hasUpstream: false, matchesUpstream: false, upstream: null };
    }
    const upstream = gitQuiet(['rev-parse', '--abbrev-ref', '@{upstream}'], worktreeRoot);
    const local = gitQuiet(['rev-parse', 'HEAD'], worktreeRoot);
    const remote = gitQuiet(['rev-parse', '@{upstream}'], worktreeRoot);
    return { hasUpstream: true, matchesUpstream: Boolean(local && remote && local === remote), upstream };
}

/**
 * The prune-lock reason on `worktreeRoot`, or null if the worktree is not locked. Parses
 * `git worktree list --porcelain`, whose per-worktree block carries a `locked` / `locked <reason>` line.
 */
function lockReason(worktreeRoot) {
    // Use the THROWING git path: an inspection failure (permissions/corruption) must propagate and fail the
    // caller closed, NOT be silently converted to '' → null (which release would read as "already unlocked"
    // and then delete the lease/marker while the worktree stays locked). null is returned ONLY when the
    // porcelain output is read successfully and shows no lock line.
    const out = git(['worktree', 'list', '--porcelain'], worktreeRoot);
    for (const block of out.split('\n\n')) {
        const lines = block.split('\n');
        const wl = lines.find((l) => l.startsWith('worktree '));
        if (!wl) continue;
        if (path.resolve(wl.slice('worktree '.length)) !== path.resolve(worktreeRoot)) continue;
        const locked = lines.find((l) => l === 'locked' || l.startsWith('locked '));
        if (!locked) return null;
        return locked === 'locked' ? '' : locked.slice('locked '.length);
    }
    return null;
}

/**
 * Full ownership proof for a mutation/handoff/release: current branch present, marker + registry lease
 * BOTH present and BOTH naming `agent` on the CURRENT branch. Returns the lease. Fails closed otherwise.
 */
function assertFullOwnership(ctx, agent) {
    if (!ctx.branch) throw new OwnershipError('HEAD is detached — no owned branch to prove (fail closed)');
    const marker = readMarker(ctx.gitDir);
    if (!marker) throw new OwnershipError(`no owner marker for ${ctx.worktreeRoot}; claim it first`);
    const lease = readLeases(ctx.commonDir).find((l) => l.worktreePath === ctx.worktreeRoot);
    if (!lease) throw new OwnershipError(`no registry lease for ${ctx.worktreeRoot}; marker is orphaned (fail closed)`);
    // Marker and lease must agree on EVERY authoritative field (agent, task, path, branch, baseSha,
    // createdAt) — a mismatch means tampering or drift and fails closed. readLeases already required
    // baseSha to be present + non-empty in the registry.
    for (const f of LEASE_STRING_FIELDS) {
        if (marker[f] !== lease[f]) throw new OwnershipError(`marker/lease disagree on '${f}' — fail closed`);
    }
    if (lease.agent !== agent) throw new OwnershipError(`worktree owned by '${lease.agent}', not '${agent}'`);
    if (lease.branch !== ctx.branch) throw new OwnershipError(`checked-out branch '${ctx.branch}' is not the owned branch '${lease.branch}'`);
    return { marker, lease };
}

// ── commands ────────────────────────────────────────────────────────────────

function cmdClaim({ agent, task, cwd }) {
    requireAgent(agent, 'claim');
    if (!task || String(task).trim() === '') throw new OwnershipError('claim requires a non-blank --task <issue>');
    const ctx = resolveContext(cwd);
    assertPersistentPath(ctx.worktreeRoot);
    if (!ctx.branch) throw new OwnershipError('claim requires a checked-out branch (HEAD is detached)');
    if (!ctx.headSha) throw new OwnershipError('claim requires a commit (HEAD has no baseSha)');
    // This tool governs LINKED worktrees only — the primary checkout cannot satisfy the prune-lock
    // contract and must never be leased. (linked → gitDir is under <common>/worktrees/<id>.)
    if (path.resolve(ctx.gitDir) === path.resolve(ctx.commonDir)) {
        throw new OwnershipError('refusing to claim the primary checkout; run inside a linked worktree');
    }
    return withLock(ctx.commonDir, () => {
        const leases = readLeases(ctx.commonDir);
        const existingLease = leases.find((l) => l.worktreePath === ctx.worktreeRoot);
        const existingMarker = readMarker(ctx.gitDir); // throws on a corrupt marker → no silent repair

        // Conflicts: branch uniqueness is enforced REGARDLESS of agent (a duplicate-branch record would
        // brick readLeases for every worktree); a different agent cannot take this worktree.
        for (const l of leases) {
            if (l.worktreePath === ctx.worktreeRoot && l.agent !== agent) {
                throw new OwnershipError(`worktree already owned by '${l.agent}' (task ${l.task}); release first`);
            }
            if (l.branch === ctx.branch && l.worktreePath !== ctx.worktreeRoot) {
                throw new OwnershipError(`branch '${ctx.branch}' already writable at '${l.worktreePath}'; one writer per branch`);
            }
        }

        // Idempotent reclaim: a first claim requires NEITHER marker nor lease; a re-claim requires BOTH,
        // consistent with each other on every authoritative field and naming this agent+branch — then it
        // is a NO-OP (no baseSha/createdAt drift). Anything partial/contradictory fails closed.
        const hasMarker = existingMarker != null;
        const hasLease = existingLease != null;
        if (hasMarker !== hasLease) {
            throw new OwnershipError('inconsistent state: exactly one of marker/registry-lease exists — resolve manually (fail closed)');
        }
        if (hasMarker && hasLease) {
            const fieldsAgree = LEASE_STRING_FIELDS.every((f) => existingMarker[f] === existingLease[f]);
            const ownedByCaller = existingLease.agent === agent && existingLease.branch === ctx.branch;
            if (!fieldsAgree || !ownedByCaller) {
                throw new OwnershipError('existing marker/lease is inconsistent or contradicts this claim — resolve manually (fail closed)');
            }
            // A valid lease is not enough — the anti-prune lock must STILL be in place and ours. If it was
            // removed out of band, restore our own lock; if a foreign lock replaced it, refuse. Otherwise an
            // idempotent reclaim would report ownership over an unprotected (prunable) worktree.
            const reason = lockReason(ctx.worktreeRoot);
            if (reason === null) {
                try {
                    git(['worktree', 'lock', '--reason', LOCK_REASON, ctx.worktreeRoot], ctx.worktreeRoot);
                } catch (e) {
                    throw new OwnershipError(`idempotent reclaim could not restore the missing prune lock: ${String(e.stderr ?? e.message ?? e)}`);
                }
            } else if (reason !== LOCK_REASON) {
                throw new OwnershipError(`idempotent reclaim found a foreign worktree lock (reason: ${JSON.stringify(reason)}) not created by this lease — resolve manually (fail closed)`);
            }
            return `already owned by ${agent}: ${ctx.worktreeRoot} (branch ${ctx.branch})`; // idempotent no-op
        }

        // First claim: the anti-prune lock is REQUIRED and must be OURS. We stamp LOCK_REASON so release can
        // later verify the lock is ours before unlocking. A pre-existing lock is only tolerated when it
        // already carries our reason (e.g. a prior crashed claim); any other (foreign/manual) lock is
        // refused rather than adopted, since release must never remove a lock this tool did not create.
        try {
            git(['worktree', 'lock', '--reason', LOCK_REASON, ctx.worktreeRoot], ctx.worktreeRoot);
        } catch (e) {
            if (!/already locked/i.test(String(e.stderr ?? e.message ?? ''))) {
                throw new OwnershipError(`could not prune-lock the worktree (anti-prune contract): ${String(e.stderr ?? e.message ?? e)}`);
            }
            const existing = lockReason(ctx.worktreeRoot);
            if (existing !== LOCK_REASON) {
                throw new OwnershipError(`refusing a pre-existing/foreign worktree lock (reason: ${JSON.stringify(existing)}) not created by this lease — resolve manually (fail closed)`);
            }
        }
        const lease = {
            agent, task: String(task), worktreePath: ctx.worktreeRoot, branch: ctx.branch,
            baseSha: ctx.headSha, createdAt: nowIso(),
        };
        writeLeases(ctx.commonDir, [...leases, lease]);
        writeFileSync(markerPath(ctx.gitDir), `${JSON.stringify(lease, null, 2)}\n`);
        return `claimed ${ctx.worktreeRoot} (branch ${ctx.branch}) for ${agent}`;
    });
}

function cmdAssertOwner({ agent, cwd }) {
    requireAgent(agent, 'assert-owner');
    const ctx = resolveContext(cwd);
    assertFullOwnership(ctx, agent);
    return `owner confirmed: ${agent} @ ${ctx.worktreeRoot} (${ctx.branch})`;
}

function cmdHandoff({ agent, cwd }) {
    requireAgent(agent, 'handoff');
    const ctx = resolveContext(cwd);
    const { lease } = assertFullOwnership(ctx, agent); // marker + registry + branch, not just the lease
    if (!isClean(ctx.worktreeRoot)) throw new OwnershipError('working tree is dirty — commit or discard before handoff');
    const up = upstreamState(ctx.worktreeRoot);
    if (!up.hasUpstream) throw new OwnershipError('branch has no upstream — push it before handoff');
    if (!up.matchesUpstream) throw new OwnershipError('HEAD does not equal the pushed upstream — push before handoff');
    return JSON.stringify({
        handoff: true, from: agent, worktreePath: ctx.worktreeRoot, branch: ctx.branch,
        headSha: ctx.headSha, upstream: up.upstream, task: lease.task, at: nowIso(),
        note: 'Recipient: create/claim your OWN worktree and review this pushed SHA. Ownership unchanged until the current owner runs `release`.',
    }, null, 2);
}

function cmdRelease({ agent, cwd }) {
    requireAgent(agent, 'release');
    const ctx = resolveContext(cwd);
    return withLock(ctx.commonDir, () => {
        assertFullOwnership(ctx, agent); // marker + registry + branch
        if (!isClean(ctx.worktreeRoot)) throw new OwnershipError('working tree is dirty — commit/discard before release');
        const up = upstreamState(ctx.worktreeRoot);
        if (!(up.hasUpstream && up.matchesUpstream)) throw new OwnershipError('HEAD is not pushed to its upstream — push before release');
        // Remove the prune lock FIRST and only if it is OURS (LOCK_REASON), surfacing any failure. Doing it
        // before dropping the lease + marker keeps release retryable: a foreign lock or a failed unlock
        // aborts here with the ownership records still intact, rather than reporting success while the
        // worktree stays unexpectedly locked and unrecoverable through this workflow.
        const reason = lockReason(ctx.worktreeRoot);
        if (reason !== null) {
            if (reason !== LOCK_REASON) {
                throw new OwnershipError(`worktree lock (reason: ${JSON.stringify(reason)}) was not created by this lease — refusing to remove it (fail closed)`);
            }
            try {
                git(['worktree', 'unlock', ctx.worktreeRoot], ctx.worktreeRoot);
            } catch (e) {
                throw new OwnershipError(`failed to remove the prune lock (release aborted, lease kept for retry): ${String(e.stderr ?? e.message ?? e)}`);
            }
        }
        const leases = readLeases(ctx.commonDir);
        writeLeases(ctx.commonDir, leases.filter((l) => l.worktreePath !== ctx.worktreeRoot));
        const mp = markerPath(ctx.gitDir);
        if (existsSync(mp)) unlinkSync(mp);
        return `released ${ctx.worktreeRoot} (was ${agent}); branch + worktree left intact`;
    });
}

function cmdStatus({ cwd, json }) {
    const ctx = resolveContext(cwd);
    const leases = readLeases(ctx.commonDir);
    const marker = readMarker(ctx.gitDir);
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
