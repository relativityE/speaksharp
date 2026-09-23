/**
 * #1045 — durable, owner-scoped queue of sessions whose Progress evaluation could not be recorded at save
 * time (a transient RPC failure, or a tab closed mid-request). Persisted in localStorage so a closed tab or
 * a longer outage does not permanently drop the immutable record: the entries are drained on the next
 * authenticated load (see `reconcileProgressEvaluations`).
 *
 * The RPC is idempotent per `(session, formula_version)`, so re-recording a session already recorded is a
 * harmless no-op — the queue never risks a duplicate.
 *
 * #1354 — EVERY OPERATION REPORTS A VERIFIED RESULT.
 *
 * Writes are confirmed by READBACK, reads distinguish unavailable/corrupt from empty, and any failure is
 * reported so the caller can fail closed and keep the recorder blocked.
 *
 * #1476 — ONE STORAGE KEY PER (OWNER, SESSION). NO SHARED ARRAY.
 *
 * v1 kept every owner's debt in ONE localStorage value. Each mutation read the whole array, computed the next array
 * and wrote it back, and browsing contexts of one origin run concurrently, so another tab's write landing between a
 * tab's read and its write was silently erased while both tabs' readbacks still reported `verified`. v2 stores each
 * entry under its own key, so a mutation only ever rewrites the entry it is about:
 *
 *   `ss_progress_reconcile_queue_v2|e|<owner>|<session>`   the entry (JSON QueueEntry)
 *   `ss_progress_reconcile_queue_v2|t|<owner>|<session>`   a tombstone for a retired obligation
 *
 * Owner and session are `encodeURIComponent`-encoded, which never emits `|`, so no two pairs can share a key.
 *
 * SAME-ENTRY WRITES are monotonic. `attempts` never decreases and a release is never undone: every write merges the
 * value it proposes with a fresh read of the same key taken immediately before it, and reads merge any duplicate view
 * (v1 and v2) the same way. Cross-tab attempts on one entry are additionally serialized by the RWT-20 attempt lock
 * (`progressAttemptOwnership.ts`) where Web Locks exist; the merge is what holds where they do not.
 *
 * v1 → v2 COMPATIBILITY. Reads are pure and treat any v1 value as a source: its entries join the view unless a
 * tombstone retires them. Every mutation first MIGRATES v1 idempotently — copy each entry (merged), verify every
 * copy, and only then remove the v1 value. A still-open tab running the old code can write v1 again at any time;
 * those entries are simply migrated again, and a tombstone guarantees a debt this tab already retired is never
 * resurrected from a stale v1 copy. A corrupt v1 value cannot be attributed to an owner, so it fails closed for
 * every owner and blocks migration, exactly as a corrupt queue always has.
 */
import logger from '@/lib/logger';

/**
 * #1354: the SINGLE definition of the v1 aggregate key (still read for compatibility, and still what a tab running
 * older code writes). #1476: v2 entries live under `PROGRESS_QUEUE_V2_PREFIX`. Cross-tab listeners must react to both.
 */
export const PROGRESS_QUEUE_STORAGE_KEY = 'ss_progress_reconcile_queue_v1';
export const PROGRESS_QUEUE_V2_PREFIX = 'ss_progress_reconcile_queue_v2|';
const V1_KEY = PROGRESS_QUEUE_STORAGE_KEY;
const ENTRY_PREFIX = `${PROGRESS_QUEUE_V2_PREFIX}e|`;
const TOMB_PREFIX = `${PROGRESS_QUEUE_V2_PREFIX}t|`;

export interface QueueEntry {
    sessionId: string;
    userId: string;
    /** ms epoch as a string is avoided — kept as a plain field only for observability, never for ordering. */
    enqueuedAtIso: string;
    /** RWT-20: reconciliation attempts made against this debt, so the retry bound and age survive a reload. */
    attempts?: number;
    lastAttemptAtIso?: string;
    /**
     * RWT-20: set once the bounded in-page retries are exhausted. A RELEASED entry no longer holds Start, but it is
     * still owed: it stays in the queue and is retried on later loads until its evaluation is durably recorded.
     */
    releasedAtIso?: string;
}

/** #1476: a retired obligation. Any v1 copy of this (owner, session) enqueued at or before `clearedThroughIso` stays retired. */
interface Tombstone {
    sessionId: string;
    userId: string;
    clearedThroughIso: string;
}

export type QueueFailure =
    | 'storage_unavailable'
    | 'corrupt'
    | 'write_failed'
    | 'readback_failed';

export type QueueReadResult =
    | { ok: true; entries: QueueEntry[] }
    | { ok: false; failure: QueueFailure };

export type QueueWriteResult =
    | { ok: true; verified: true }
    | { ok: false; failure: QueueFailure };

const enc = encodeURIComponent;
/** #1476: the storage key of one (owner, session) entry. Exported for listeners and tests. */
export const progressQueueEntryKey = (userId: string, sessionId: string): string => `${ENTRY_PREFIX}${enc(userId)}|${enc(sessionId)}`;
const tombKey = (userId: string, sessionId: string): string => `${TOMB_PREFIX}${enc(userId)}|${enc(sessionId)}`;
const pairKey = (userId: string, sessionId: string): string => `${userId}\u0000${sessionId}`;

const optionalString = (v: unknown) => v === undefined || typeof v === 'string';
const validEntry = (e: unknown): e is QueueEntry =>
    !!e && typeof e === 'object'
    && typeof (e as QueueEntry).sessionId === 'string' && (e as QueueEntry).sessionId !== ''
    && typeof (e as QueueEntry).userId === 'string' && (e as QueueEntry).userId !== ''
    && typeof (e as QueueEntry).enqueuedAtIso === 'string'
    // RWT-20 fields are optional (older entries carry none), but when present they must have their shape: a
    // malformed release marker could otherwise unlock Start on debt nobody actually released.
    && ((e as QueueEntry).attempts === undefined
        || (Number.isInteger((e as QueueEntry).attempts) && ((e as QueueEntry).attempts as number) >= 0))
    && optionalString((e as QueueEntry).lastAttemptAtIso)
    && optionalString((e as QueueEntry).releasedAtIso);
const validTomb = (t: unknown): t is Tombstone =>
    !!t && typeof t === 'object'
    && typeof (t as Tombstone).sessionId === 'string' && (t as Tombstone).sessionId !== ''
    && typeof (t as Tombstone).userId === 'string' && (t as Tombstone).userId !== ''
    && typeof (t as Tombstone).clearedThroughIso === 'string';

const ISO = /^\d{4}-\d{2}-\d{2}T/;
/** A tombstone retires an entry enqueued at or before it (ISO stamps), or with exactly its stamp (anything else). */
const retiredBy = (entry: QueueEntry, tomb: Tombstone | undefined): boolean => {
    if (!tomb) return false;
    if (ISO.test(entry.enqueuedAtIso) && ISO.test(tomb.clearedThroughIso)) return entry.enqueuedAtIso <= tomb.clearedThroughIso;
    return entry.enqueuedAtIso === tomb.clearedThroughIso;
};
const laterIso = (a?: string, b?: string): string | undefined => {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return ISO.test(a) && ISO.test(b) ? (a >= b ? a : b) : a;
};
const earlierIso = (a?: string, b?: string): string | undefined => {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return ISO.test(a) && ISO.test(b) ? (a <= b ? a : b) : a;
};

/**
 * #1476 MONOTONIC MERGE of two views of the same obligation: attempts never decrease, a release is never undone, and
 * the obligation keeps its original enqueue stamp.
 */
function mergeEntries(a: QueueEntry, b: QueueEntry): QueueEntry {
    const attempts = a.attempts === undefined && b.attempts === undefined ? undefined : Math.max(a.attempts ?? 0, b.attempts ?? 0);
    const merged: QueueEntry = {
        sessionId: a.sessionId,
        userId: a.userId,
        enqueuedAtIso: earlierIso(a.enqueuedAtIso, b.enqueuedAtIso) as string,
    };
    if (attempts !== undefined) merged.attempts = attempts;
    const lastAttemptAtIso = laterIso(a.lastAttemptAtIso, b.lastAttemptAtIso);
    if (lastAttemptAtIso !== undefined) merged.lastAttemptAtIso = lastAttemptAtIso;
    const releasedAtIso = earlierIso(a.releasedAtIso, b.releasedAtIso);
    if (releasedAtIso !== undefined) merged.releasedAtIso = releasedAtIso;
    return merged;
}

type Snapshot = {
    /** Valid v2 entries, keyed by (owner, session). */
    entries: Map<string, QueueEntry>;
    tombs: Map<string, Tombstone>;
    /** v1 entries, or null when there is no v1 value. */
    v1: QueueEntry[] | null;
    /** v1 present but unreadable: unattributable, so it blocks every owner. */
    v1Corrupt: boolean;
    /** Owners with at least one unreadable v2 key. Their view fails closed; other owners are unaffected. */
    corruptOwners: Set<string>;
};

/** Read every queue key once. Pure: never writes, never deletes. */
function takeSnapshot(): { ok: true; snap: Snapshot } | { ok: false; failure: QueueFailure } {
    if (typeof localStorage === 'undefined') return { ok: false, failure: 'storage_unavailable' };
    const snap: Snapshot = { entries: new Map(), tombs: new Map(), v1: null, v1Corrupt: false, corruptOwners: new Set() };
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key !== null && key.startsWith(PROGRESS_QUEUE_V2_PREFIX)) keys.push(key);
        }
        for (const key of keys) {
            const isEntry = key.startsWith(ENTRY_PREFIX);
            const rest = key.slice((isEntry ? ENTRY_PREFIX : TOMB_PREFIX).length).split('|');
            let owner = '';
            let session = '';
            try {
                owner = decodeURIComponent(rest[0] ?? '');
                session = decodeURIComponent(rest[1] ?? '');
            } catch { /* an undecodable key is corrupt below */ }
            const raw = localStorage.getItem(key);
            if (raw === null) continue; // removed between enumeration and read: nothing is owed under it
            let parsed: unknown;
            try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
            const wellFormedKey = rest.length === 2 && owner !== '' && session !== ''
                && (key.startsWith(ENTRY_PREFIX) || key.startsWith(TOMB_PREFIX));
            if (isEntry && wellFormedKey && validEntry(parsed) && parsed.userId === owner && parsed.sessionId === session) {
                snap.entries.set(pairKey(owner, session), parsed);
            } else if (!isEntry && wellFormedKey && validTomb(parsed) && parsed.userId === owner && parsed.sessionId === session) {
                snap.tombs.set(pairKey(owner, session), parsed);
            } else {
                // FAIL CLOSED FOR THIS OWNER ONLY. A dropped entry is a lost debt; an unreadable tombstone means we
                // cannot tell what is retired. Neither may hide or delete a valid sibling entry.
                snap.corruptOwners.add(owner);
            }
        }
        const rawV1 = localStorage.getItem(V1_KEY);
        // ONLY a genuinely ABSENT key is an empty v1. The empty STRING (a truncated or partial write) must reach
        // JSON.parse, become corrupt and fail closed like any other unreadable value.
        if (rawV1 !== null) {
            let parsedV1: unknown;
            try { parsedV1 = JSON.parse(rawV1); } catch (err) {
                logger.warn({ err }, '[progress] reconcile queue v1 parse failed');
                parsedV1 = undefined;
            }
            if (Array.isArray(parsedV1) && parsedV1.every(validEntry)) snap.v1 = parsedV1;
            else snap.v1Corrupt = true;
        }
    } catch (err) {
        logger.warn({ err }, '[progress] reconcile queue read failed');
        return { ok: false, failure: 'storage_unavailable' };
    }
    return { ok: true, snap };
}

/** The merged, tombstone-filtered view of every obligation in a snapshot (optionally one owner's). */
function viewOf(snap: Snapshot, ownerId?: string): QueueEntry[] {
    const view = new Map<string, QueueEntry>();
    for (const [k, e] of snap.entries) {
        if (ownerId !== undefined && e.userId !== ownerId) continue;
        if (retiredBy(e, snap.tombs.get(k))) continue;
        view.set(k, e);
    }
    for (const e of snap.v1 ?? []) {
        if (ownerId !== undefined && e.userId !== ownerId) continue;
        const k = pairKey(e.userId, e.sessionId);
        if (retiredBy(e, snap.tombs.get(k))) continue;
        const existing = view.get(k);
        view.set(k, existing ? mergeEntries(existing, e) : e);
    }
    return [...view.values()];
}

/**
 * Read the WHOLE queue, distinguishing UNAVAILABLE and CORRUPT from genuinely EMPTY. Any unreadable value anywhere
 * makes this read `corrupt`, as it always has: a dropped entry is a lost Progress debt.
 */
export function readProgressReconcileQueue(): QueueReadResult {
    const s = takeSnapshot();
    if (!s.ok) return s;
    if (s.snap.v1Corrupt || s.snap.corruptOwners.size > 0) return { ok: false, failure: 'corrupt' };
    return { ok: true, entries: viewOf(s.snap) };
}

/** One owner's view. #1476: another owner's unreadable entry no longer blocks this owner; an unreadable v1 still does. */
function readOwner(userId: string): QueueReadResult {
    const s = takeSnapshot();
    if (!s.ok) return s;
    if (s.snap.v1Corrupt || s.snap.corruptOwners.has(userId)) return { ok: false, failure: 'corrupt' };
    return { ok: true, entries: viewOf(s.snap, userId) };
}

function readOwnEntry(userId: string, sessionId: string): { ok: true; entry: QueueEntry | undefined } | { ok: false; failure: QueueFailure } {
    const res = readOwner(userId);
    if (!res.ok) return res;
    return { ok: true, entry: res.entries.find((e) => e.sessionId === sessionId) };
}

/** Write one key, then READ BACK and confirm. A write that cannot be verified is not a durable write. */
function setVerified(key: string, value: unknown, confirm: () => boolean): QueueWriteResult {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
        logger.warn({ err }, '[progress] reconcile queue write failed');
        return { ok: false, failure: 'write_failed' };
    }
    return confirm() ? { ok: true, verified: true } : { ok: false, failure: 'readback_failed' };
}

function removeVerified(key: string): QueueWriteResult {
    try {
        localStorage.removeItem(key);
    } catch (err) {
        logger.warn({ err }, '[progress] reconcile queue removal failed');
        return { ok: false, failure: 'write_failed' };
    }
    try {
        return localStorage.getItem(key) === null ? { ok: true, verified: true } : { ok: false, failure: 'readback_failed' };
    } catch {
        return { ok: false, failure: 'readback_failed' };
    }
}

/**
 * THE ONE FRESH MERGE AUTHORITY (PM RETURN on cd79ba3f, P1-B). Read the pair's tombstone and entry IMMEDIATELY before a
 * write — never from an earlier snapshot, which another tab may have moved past:
 *  - a proposal the fresh tombstone retires is not materialized at all (`retired`): a clear that landed after the
 *    snapshot keeps the debt retired;
 *  - the current entry is merged only if the fresh tombstone does NOT retire it. A stale raw entry left behind by an
 *    interrupted clear must never absorb a genuinely newer obligation — `mergeEntries` keeps the EARLIER enqueue
 *    time, so that merge would carry the new obligation under the tombstone and hide it.
 */
function freshMergeTarget(proposal: QueueEntry): { retired: true } | { retired: false; next: QueueEntry } {
    let tomb: Tombstone | undefined;
    try {
        const rawTomb = localStorage.getItem(tombKey(proposal.userId, proposal.sessionId));
        const parsed: unknown = rawTomb === null ? undefined : JSON.parse(rawTomb);
        if (validTomb(parsed) && parsed.userId === proposal.userId && parsed.sessionId === proposal.sessionId) tomb = parsed;
    } catch { /* an unreadable tombstone retires nothing here; reads of that owner fail closed on it */ }
    if (retiredBy(proposal, tomb)) return { retired: true };
    let next = proposal;
    try {
        const raw = localStorage.getItem(progressQueueEntryKey(proposal.userId, proposal.sessionId));
        const current: unknown = raw === null ? undefined : JSON.parse(raw);
        if (validEntry(current) && current.userId === proposal.userId && current.sessionId === proposal.sessionId
            && !retiredBy(current, tomb)) {
            next = mergeEntries(current, proposal);
        }
    } catch { /* an unreadable current value is overwritten only by the verified merge below */ }
    return { retired: false, next };
}

/**
 * Write one entry MONOTONICALLY: merge the proposal with a fresh read of the same key taken immediately before the
 * write, then confirm by readback that the stored entry satisfies `expect`.
 */
function writeEntryMonotonic(proposal: QueueEntry, expect: (stored: QueueEntry) => boolean): QueueWriteResult {
    const key = progressQueueEntryKey(proposal.userId, proposal.sessionId);
    const target = freshMergeTarget(proposal);
    // A proposal a tombstone already retires is not a new obligation: writing it would only be hidden again.
    if (target.retired) return { ok: true, verified: true };
    const next = target.next;
    return setVerified(key, next, () => {
        const own = readOwnEntry(proposal.userId, proposal.sessionId);
        return own.ok && !!own.entry && expect(own.entry);
    });
}

/**
 * #1476 v1 → v2 MIGRATION, idempotent and crash-safe: every live v1 entry gets its own verified v2 copy.
 *
 * PM RETURN on cd79ba3f — v1 IS RETAINED, NEVER DELETED HERE (P1-A). While a tab still running the old code may exist,
 * it can append to v1 at any moment, and localStorage offers no compare-and-delete: removing v1 after copying a
 * snapshot of it deletes whatever an old tab wrote in between — debt this tab never saw. So v1 stays as a read-only
 * compatibility source. Reads already merge v1 with v2, tombstones keep a retained stale v1 entry from resurrecting
 * retired debt, and each later mutation re-runs this copy, so a late old-tab obligation reaches v2 too.
 *
 * Each copy goes through the fresh merge authority (P1-B), never the snapshot's view of v2, and is confirmed against
 * its v2 key alone — the retained v1 copy cannot be what satisfies the readback.
 */
function migrateV1Entry(e: QueueEntry): QueueWriteResult {
    const key = progressQueueEntryKey(e.userId, e.sessionId);
    const target = freshMergeTarget(e);
    if (target.retired) return { ok: true, verified: true }; // retired after the snapshot: stays retired
    const next = target.next;
    return setVerified(key, next, () => {
        try {
            const raw = localStorage.getItem(key);
            const back: unknown = raw === null ? undefined : JSON.parse(raw);
            return validEntry(back) && (back.attempts ?? 0) >= (next.attempts ?? 0)
                && (next.releasedAtIso === undefined || typeof back.releasedAtIso === 'string');
        } catch { return false; }
    });
}

function migrateV1(): QueueWriteResult {
    const s = takeSnapshot();
    if (!s.ok) return s;
    if (s.snap.v1Corrupt) return { ok: false, failure: 'corrupt' };
    if (s.snap.v1 === null) return { ok: true, verified: true };
    for (const e of s.snap.v1) {
        const k = pairKey(e.userId, e.sessionId);
        if (retiredBy(e, s.snap.tombs.get(k))) continue; // retired already: nothing to copy
        const existing = s.snap.entries.get(k);
        // Already fully represented in v2 (monotonic fields only grow), so there is nothing to write.
        if (existing && !retiredBy(existing, s.snap.tombs.get(k))
            && JSON.stringify(existing) === JSON.stringify(mergeEntries(existing, e))) continue;
        const written = migrateV1Entry(e);
        if (!written.ok) return written;
    }
    return { ok: true, verified: true };
}

/**
 * Owner-scoped enqueue, VERIFIED.
 *
 * `ok` means the exact (session, user) entry is present in storage after the call — either it was
 * already there, or the write was confirmed by readback. Anything else is a failure the caller must
 * treat as "not durably queued".
 */
export function enqueueProgressReconcile(sessionId: string, userId: string, nowIso: string): QueueWriteResult {
    if (!sessionId || !userId) return { ok: false, failure: 'write_failed' };
    const migrated = migrateV1();
    if (!migrated.ok) return migrated;
    const own = readOwnEntry(userId, sessionId);
    if (!own.ok) return { ok: false, failure: own.failure };
    // Already queued is a durable success: the debt is recorded, which is all `queued` claims.
    if (own.entry) return { ok: true, verified: true };
    const fresh: QueueEntry = { sessionId, userId, enqueuedAtIso: nowIso };
    // A tombstone that would retire THIS new obligation (same stamp, or a clock that moved backwards) is removed first.
    // A stale v1 copy it was guarding carries the same session and a stamp no newer, so it is this same obligation.
    const s = takeSnapshot();
    if (!s.ok) return s;
    if (retiredBy(fresh, s.snap.tombs.get(pairKey(userId, sessionId)))) {
        const removed = removeVerified(tombKey(userId, sessionId));
        if (!removed.ok) return removed;
    }
    return writeEntryMonotonic(fresh, () => true);
}

/** The session ids queued for THIS user (owner-scoped — never drains another account's entries). */
export function getQueuedSessionIdsForUser(userId: string): QueueReadResult & { sessionIds?: string[] } {
    const res = readOwner(userId);
    if (!res.ok) return res;
    return { ...res, sessionIds: res.entries.map((e) => e.sessionId) };
}

/**
 * Remove a resolved (session,user) entry once its evaluation is durably recorded — VERIFIED.
 *
 * #1476: the TOMBSTONE is written first, then the entry removed. A crash between the two leaves the entry retired
 * (reads skip what a tombstone covers), and no stale v1 copy of this obligation can ever bring it back.
 */
export function clearProgressReconcileEntry(sessionId: string, userId: string): QueueWriteResult {
    const migrated = migrateV1();
    if (!migrated.ok) return migrated;
    const s = takeSnapshot();
    if (!s.ok) return s;
    if (s.snap.v1Corrupt || s.snap.corruptOwners.has(userId)) return { ok: false, failure: 'corrupt' };
    const k = pairKey(userId, sessionId);
    const entry = viewOf(s.snap, userId).find((e) => e.sessionId === sessionId);
    const stored = s.snap.entries.get(k);
    if (!entry && !stored) return { ok: true, verified: true }; // nothing to remove
    const stamp = laterIso(entry?.enqueuedAtIso ?? stored?.enqueuedAtIso, s.snap.tombs.get(k)?.clearedThroughIso) as string;
    const tomb: Tombstone = { sessionId, userId, clearedThroughIso: stamp };
    const tombWritten = setVerified(tombKey(userId, sessionId), tomb, () => {
        try {
            const raw = localStorage.getItem(tombKey(userId, sessionId));
            const back: unknown = raw === null ? undefined : JSON.parse(raw);
            return validTomb(back) && back.clearedThroughIso === stamp;
        } catch { return false; }
    });
    if (!tombWritten.ok) return tombWritten;
    const removed = removeVerified(progressQueueEntryKey(userId, sessionId));
    if (!removed.ok) return removed;
    const after = readOwnEntry(userId, sessionId);
    return after.ok && !after.entry ? { ok: true, verified: true } : { ok: false, failure: after.ok ? 'readback_failed' : after.failure };
}

/** RWT-20: this owner's entries, released or not — the Start gate and the retry schedule both read these. */
export function getQueueEntriesForUser(userId: string): QueueReadResult {
    return readOwner(userId);
}

/**
 * RWT-20: record one failed reconciliation attempt on the entry — VERIFIED. `attempts` is the count after this
 * call. An entry that is no longer present (retired by another tab) needs nothing recorded.
 */
export function recordProgressReconcileAttempt(
    sessionId: string,
    userId: string,
    nowIso: string,
): QueueWriteResult & { attempts?: number } {
    const migrated = migrateV1();
    if (!migrated.ok) return migrated;
    const own = readOwnEntry(userId, sessionId);
    if (!own.ok) return { ok: false, failure: own.failure };
    if (!own.entry) return { ok: true, verified: true };
    const attempts = (own.entry.attempts ?? 0) + 1;
    const written = writeEntryMonotonic({ ...own.entry, attempts, lastAttemptAtIso: nowIso }, (stored) => (stored.attempts ?? 0) >= attempts);
    return written.ok ? { ...written, attempts } : written;
}

/**
 * RWT-20: release an entry's hold on Start after its bounded retries — VERIFIED. The entry itself is kept: release
 * frees the recorder, it never forgives the debt. Already released, or already retired, is a durable success.
 */
export function releaseProgressReconcileEntry(sessionId: string, userId: string, nowIso: string): QueueWriteResult {
    const migrated = migrateV1();
    if (!migrated.ok) return migrated;
    const own = readOwnEntry(userId, sessionId);
    if (!own.ok) return { ok: false, failure: own.failure };
    if (!own.entry || own.entry.releasedAtIso) return { ok: true, verified: true };
    return writeEntryMonotonic({ ...own.entry, releasedAtIso: nowIso }, (stored) => typeof stored.releasedAtIso === 'string');
}
