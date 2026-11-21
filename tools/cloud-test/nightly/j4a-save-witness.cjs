'use strict';
// J4.a offline connector (Sam, 21 Nov): "one lost save -> one Retry -> exactly one saved take, prove the writer stopped and verify
// run-owned cleanup. Keep a refusal test for missing proof." The PARENT owns every fact this module decides on:
//   - the save journal: armed by the parent (exclusive create, a fresh token) BEFORE the supervised case process starts, sealed by the
//     parent AFTER that process has exited with no owned descendants. The reviewed guard appends one line per writer attempt (signup,
//     Start, save completion, coaching, lease) and per explicit Retry intent, hash-chained to the line before;
//   - the supervisor's close: the parent's own supervisedCommand result (exit, signal, deadline, process-group cleanup) and the case's
//     cleanup record;
//   - the takes: the parent's own read of the bound owner's sessions during teardown, before anything is deleted.
// From those it decides, fail closed:
//   1. the save path: exactly one completion dropped before it left (planned-request-lost, upstream never started), then exactly one
//      explicit Retry for that same take, then exactly one forwarded completion for it with a backend-confirmed terminal readback of
//      exactly one saved row; every other take saved by exactly one confirmed completion; nothing else dropped, retried or unresolved;
//   2. the stopped writer: j4a-writer-evidence's verifyJ4aStoppedWriters over these records (never a canned or child-supplied proof);
//   3. the takes: the bound take is exactly one completed row, and the completed rows are exactly the confirmed saves (no duplicate,
//      no extra, nothing missing, nothing left open).
// Anything missing, malformed, out of order or unobserved is HOLD. The row gate then holds the case's save rows unless all three agree,
// so a child-reported PASS alone never passes J4.a. Offline only: the production guard does not write this journal yet (the sealed
// harness packet would have to, in a separately reviewed change), so a live run keeps teardown and the leg on HOLD. Content-free: the
// journal carries sha-256 digests of sessions and attempts, never ids, emails or bodies.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { verifyJ4aStoppedWriters } = require('./j4a-writer-evidence.cjs');

const SCHEMA = 'speaksharp.nightly.j4a-save-journal.v1';
const SHA = /^[a-f0-9]{64}$/;
const WRITER_KINDS = Object.freeze(['signup', 'start', 'save', 'coaching', 'lease']);
const SAVE_ROWS = Object.freeze(['fault-exercised', 'retry-saved-once', 'completion-attempts']);
const RUN_GUARDED = path.join('harness', 'run-guarded.cjs');
const ENTRY_KEYS = Object.freeze(['attempt', 'binding', 'decision', 'kind', 'prev', 'runId', 'seq', 'session', 'terminal', 'token', 'upstreamStarted']);
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const hold = (reason) => Object.freeze({ verdict: 'HOLD', reason });

/**
 * Reads the sealed journal bytes. Returns { entries } or { hold }: the header must carry this witness's token, and every entry the
 * closed shape, the same token, contiguous sequence numbers and the digest of the line before it.
 */
function parseJournal(bytes, token) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) return { hold: 'the save journal is empty or torn' };
    const lines = bytes.toString('utf8').slice(0, -1).split('\n');
    let header;
    try { header = JSON.parse(lines[0]); } catch { return { hold: 'the save journal header is unreadable' }; }
    if (!header || header.schema !== SCHEMA || header.token !== token || Object.keys(header).sort().join() !== 'schema,token')
        return { hold: 'the save journal was not armed by this witness' };
    const entries = [];
    let prev = sha(lines[0]);
    for (let i = 1; i < lines.length; i += 1) {
        let e;
        try { e = JSON.parse(lines[i]); } catch { return { hold: 'a save journal line is unreadable' }; }
        if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).sort().join() !== ENTRY_KEYS.join())
            return { hold: 'a save journal line has the wrong shape' };
        if (e.token !== token || e.seq !== i || e.prev !== prev) return { hold: 'the save journal chain is broken' };
        prev = sha(lines[i]);
        entries.push(e);
    }
    return { entries };
}

/**
 * The save path, from the journal's entries for one binding and run. Resolves { verdict: 'CONFIRMED', boundSession, droppedSave,
 * savedSessions } or { verdict: 'HOLD', reason }.
 */
// The two planned save faults (journey plan J4). J4.a: the request never leaves the page (no upstream, no terminal). J4.b: the
// request reaches the server, which commits one row and answers; the guard records that confirmed answer but never hands it to the
// page (`pageAnswered: false`). Either way the page saw no answer, and one explicit Retry follows.
const SAVE_FAULTS = Object.freeze({
    'request-lost': Object.freeze({ decision: 'planned-request-lost',
        dropped: (e) => e.upstreamStarted === false && e.terminal === null,
        refusal: 'the lost save may have left: its upstream was not proven unstarted' }),
    'response-lost': Object.freeze({ decision: 'planned-response-lost',
        dropped: (e) => e.upstreamStarted === true && e.terminal?.attempt === e.attempt && e.terminal.backendConfirmed === true
            && e.terminal.savedRowCount === 1 && e.terminal.pageAnswered === false,
        refusal: 'the lost answer was not proven: the server\'s confirmed single row, withheld from the page, is missing' }),
});

function decideSavePath(entries, { binding, runId, fault }) {
    const planned = Object.hasOwn(SAVE_FAULTS, fault) ? SAVE_FAULTS[fault] : null;
    if (!planned) return hold('no planned save fault for this witness');
    if (!Array.isArray(entries)) return hold('no save journal entries');
    if (!SHA.test(binding ?? '') || typeof runId !== 'string' || !runId) return hold('no bound run for the save journal');
    const seen = new Set();
    for (const [i, e] of entries.entries()) {
        if (!e || e.seq !== i + 1) return hold('the save journal entries are out of order');
        if (e.binding !== binding || e.runId !== runId) return hold('a save journal entry belongs to another binding or run');
        if (!SHA.test(e.attempt ?? '') || seen.has(e.attempt)) return hold('a save journal attempt is malformed or repeated');
        seen.add(e.attempt);
        if (![...WRITER_KINDS, 'retry-intent'].includes(e.kind)) return hold('a save journal entry has an unknown kind');
        if ((e.kind === 'save' || e.kind === 'retry-intent') && !SHA.test(e.session ?? '')) return hold('a save or Retry names no take');
    }
    const other = Object.values(SAVE_FAULTS).find((f) => f !== planned).decision;
    if (entries.some((e) => e.decision === other)) return hold('the journal names the other planned save fault');
    const drops = entries.filter((e) => e.kind === 'save' && e.decision === planned.decision);
    if (drops.length !== 1) return hold(`expected exactly one lost save, saw ${drops.length}`);
    const [drop] = drops;
    if (!planned.dropped(drop)) return hold(planned.refusal);
    const confirmed = (e) => e.decision === 'forwarded' && e.upstreamStarted === true && e.terminal?.attempt === e.attempt
        && e.terminal.backendConfirmed === true && e.terminal.savedRowCount === 1;
    const retries = entries.filter((e) => e.kind === 'retry-intent');
    if (retries.length !== 1) return hold(`expected exactly one explicit Retry, saw ${retries.length}`);
    const [retry] = retries;
    if (retry.session !== drop.session || retry.seq < drop.seq) return hold('the Retry is not for the lost take, or came before it was lost');
    const bound = entries.filter((e) => e.kind === 'save' && e.session === drop.session);
    if (bound.length !== 2 || bound[0] !== drop) return hold(`the lost take has ${bound.length} completion attempt(s), not the lost one and one Retry`);
    const retried = bound[1];
    if (retried.seq < retry.seq) return hold('the second completion was sent before the explicit Retry');
    if (!confirmed(retried)) return hold('the retried completion has no backend-confirmed single saved row');
    const savedSessions = new Set([drop.session]);
    for (const e of entries) {
        if (e.kind !== 'save' || e.session === drop.session) continue;
        if (savedSessions.has(e.session)) return hold('another take was completed more than once');
        if (!confirmed(e)) return hold('another take\'s completion has no backend-confirmed single saved row');
        savedSessions.add(e.session);
    }
    for (const e of entries) {
        if (e.kind === 'save' || e.kind === 'retry-intent') continue;
        if (e.decision !== 'forwarded' || e.upstreamStarted !== true || e.terminal?.attempt !== e.attempt || e.terminal.backendConfirmed !== true)
            return hold(`a ${e.kind} attempt is unresolved`);
    }
    return Object.freeze({ verdict: 'CONFIRMED', reason: null, boundSession: drop.session, droppedSave: drop.attempt, savedSessions: Object.freeze([...savedSessions]) });
}

/**
 * The parent's own takes read (teardown, before any delete) against the confirmed save path: the bound take is one completed row and
 * the completed rows are exactly the confirmed saves. `rows`: [{ id, status }] for the bound owner.
 */
function decideTakes(rows, save) {
    if (save?.verdict !== 'CONFIRMED') return hold('the save path is not confirmed');
    if (!Array.isArray(rows)) return hold('the bound owner\'s takes were not read by the parent');
    if (rows.some((r) => !r || typeof r.id !== 'string' || typeof r.status !== 'string')) return hold('a take read back malformed');
    const open = rows.filter((r) => r.status !== 'completed');
    if (open.length > 0) return hold(`${open.length} take(s) are not saved`);
    const bound = rows.filter((r) => sha(r.id) === save.boundSession);
    if (bound.length !== 1) return hold(`the retried take reads back ${bound.length} time(s), not exactly once`);
    const completed = rows.map((r) => sha(r.id)).sort();
    const expected = [...save.savedSessions].sort();
    if (completed.length !== expected.length || completed.some((d, i) => d !== expected[i]))
        return hold('the saved takes read back do not match the confirmed saves (a duplicate, an extra or a missing take)');
    return Object.freeze({ verdict: 'CONFIRMED', reason: null });
}

/**
 * The parent's view of the supervised close, from its own command result and the case's cleanup record. Unknown is never clean.
 */
function supervisorClose(r, summary) {
    const ce = summary?.cleanupEvidence;
    const exited = Number.isSafeInteger(r?.status);
    const interrupted = !(r?.signal === null && r?.reason === null);
    const noDescendants = r?.cleanupIncomplete === false && summary?.killedLeftovers === undefined
        && Array.isArray(summary?.ownedProcessesRemaining) && summary.ownedProcessesRemaining.length === 0 && ce?.ownedProcessesRemaining === 0;
    const pagesClosed = ce?.schema === 'speaksharp.cloud-test.case-cleanup-evidence.v1'
        && ['launchCleanupFailure', 'mediaCleanupFailure', 'stopError', 'browserCloseError'].every((k) => ce[k] === false);
    return Object.freeze({ exited, interrupted, descendantCount: noDescendants ? 0 : null, ownedPagesClosed: pagesClosed, guardTransportDrained: ce?.guardClosed === true });
}

/**
 * One witness for one J4.a run. `dir`: a private parent directory for the journal. Use:
 *   - `commandRunner(inner)`: wraps the supervised command runner; arms the journal before the ONE case launch (handing the guard its
 *     path and token), observes the close and seals the journal after the process exits;
 *   - `verifier(expected)`: the stopped-writer seam campaign-runner calls before teardown ({ binding, runId, owner });
 *   - `observeTakes(rows)`: teardown's own takes read for the bound owner, before any delete;
 *   - `gate(result)`: the case result with the save rows held unless save path, stopped writer and takes all agree.
 */
function j4aSaveWitness({ dir, now = Date.now, fault: saveFault } = {}) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('the J4.a save witness needs an absolute private directory');
    if (!Object.hasOwn(SAVE_FAULTS, saveFault)) throw new Error('the save witness needs a planned save fault (request-lost or response-lost)');
    const state = { armed: null, launches: 0, close: null, sealed: null, save: null, writer: null, takes: null, faults: [] };
    const fault = (why) => { state.faults.push(why); };

    function arm() {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const token = crypto.randomBytes(32).toString('hex');
        const file = path.join(dir, `j4a-save-journal-${token.slice(0, 16)}.jsonl`);
        const fd = fs.openSync(file, 'wx', 0o600);
        try { fs.writeSync(fd, `${JSON.stringify({ schema: SCHEMA, token })}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        state.armed = Object.freeze({ file, token });
        return state.armed;
    }
    function seal(r, runDir) {
        let summary = null;
        try { summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8')); } catch { summary = null; }
        state.close = supervisorClose(r, summary);
        if (state.close.exited !== true || state.close.descendantCount !== 0) return fault('the case process did not exit with no owned descendants, so the journal is not sealed');
        try {
            fs.chmodSync(state.armed.file, 0o400);
            const bytes = fs.readFileSync(state.armed.file);
            state.sealed = Object.freeze({ bytes, sha256: sha(bytes), writersClosedAt: now() });
        } catch { fault('the save journal could not be sealed'); }
    }
    function commandRunner(inner) {
        if (typeof inner !== 'function') throw new Error('the J4.a save witness wraps a supervised command runner');
        return async (node, args, options, deps = {}) => {
            if (!Array.isArray(args) || typeof args[0] !== 'string' || !args[0].endsWith(RUN_GUARDED)) return inner(node, args, options, deps);
            state.launches += 1;
            if (state.launches !== 1) { fault('a second J4.a case launch'); throw new Error('J4A_SAVE_WITNESS: one case launch per witness'); }
            const runDir = args[args.indexOf('--run-dir') + 1];
            if (args.indexOf('--run-dir') < 0 || typeof runDir !== 'string') { fault('the case launch names no run directory'); throw new Error('J4A_SAVE_WITNESS: no run directory'); }
            const { file, token } = arm();
            const r = await inner(node, args, options, { ...deps, env: { ...(deps.env ?? {}), J4A_SAVE_JOURNAL: file, J4A_SAVE_JOURNAL_TOKEN: token } });
            seal(r, runDir);
            return r;
        };
    }
    function verifier(expected) {
        const { binding, runId, owner } = expected ?? {};
        state.writer = null;
        if (!state.armed || !state.sealed || state.faults.length > 0) { state.save = hold(state.faults[0] ?? 'the save journal was never armed and sealed around the case'); return null; }
        let bytes;
        try { bytes = fs.readFileSync(state.armed.file); } catch { bytes = null; }
        const intact = Buffer.isBuffer(bytes) && sha(bytes) === state.sealed.sha256;
        const parsed = intact ? parseJournal(bytes, state.armed.token) : { hold: 'the save journal changed after it was sealed' };
        if (parsed.hold) { state.save = hold(parsed.hold); return null; }
        state.save = decideSavePath(parsed.entries, { binding, runId, fault: saveFault });
        if (state.save.verdict !== 'CONFIRMED') return null;
        const identity = { binding, runId, owner };
        const token = verifyJ4aStoppedWriters({ ...identity, droppedSave: state.save.droppedSave, fault: saveFault }, {
            ...identity, ...state.close, writersClosedAt: state.sealed.writersClosedAt,
        }, {
            ...identity, armedBeforeLaunch: true, closedAfterLastWriter: true, integrityVerified: true,
            attempts: parsed.entries.filter((e) => WRITER_KINDS.includes(e.kind))
                .map((e) => ({ attempt: e.attempt, kind: e.kind, decision: e.decision, upstreamStarted: e.upstreamStarted, terminal: e.terminal })),
        });
        state.writer = token ? 'STOPPED' : 'HOLD';
        return token;
    }
    function observeTakes(rows) {
        state.takes = Array.isArray(rows) ? rows.map((r) => Object.freeze({ id: r?.id, status: r?.status })) : null;
    }
    function verdict() {
        if (!state.save) return hold('the stopped-writer check never ran, so the save journal was not read');
        if (state.save.verdict !== 'CONFIRMED') return state.save;
        if (state.writer !== 'STOPPED') return hold('the writers were not proven stopped');
        return decideTakes(state.takes, state.save);
    }
    function gate(result) {
        const v = verdict();
        if (!result || typeof result !== 'object') return result;
        const witness = Object.freeze({ verdict: v.verdict, reason: v.reason });
        if (v.verdict === 'CONFIRMED') return { ...result, j4aSaveWitness: witness };
        const held = SAVE_ROWS.map((id) => ({ id, result: 'HOLD', detail: { parentSaveWitness: v.reason } }));
        return { ...result, assertions: [...(Array.isArray(result.assertions) ? result.assertions : []), ...held], j4aSaveWitness: witness };
    }
    return Object.freeze({ commandRunner, verifier, observeTakes, gate, verdict });
}

module.exports = { SAVE_FAULTS, SAVE_ROWS, SCHEMA, decideSavePath, decideTakes, j4aSaveWitness, parseJournal, supervisorClose };
