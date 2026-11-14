/**
 * G5 (#1861, Sam on a58a348) — the durable, OWNER-BOUND record of a discarded take whose `failed` mark was not
 * confirmed.
 *
 * The controller's `pendingDiscardSettlement` slot is memory only, so a reload or hard reset dropped the take's only
 * Try again while its row, and the lease's save obligation, stayed unsettled. This record survives that, and the same
 * owner returning re-arms Try again for the same row (`rehydrateUnresolvedRecording`). Like the recovery draft it is
 * content-free (a session id, its owner and the fixed discard reason) and is never read for another account.
 */
const UNSETTLED_DISCARD_KEY = 'speaksharp_unsettled_discard';
const MAX_FIELD_LENGTH = 200;

export interface UnsettledDiscardRecord {
    sessionId: string;
    userId: string;
    reason: string;
    savedAt: string;
}

const isBoundedString = (v: unknown): v is string =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_FIELD_LENGTH;

const MAX_OWNERS = 20;

/**
 * One record per owner, so one account's unsettled discard never overwrites another's on a shared browser. Within an
 * owner there is at most one: Start is refused while that owner's discard is unsettled.
 */
function readAll(): Record<string, UnsettledDiscardRecord> {
    try {
        const raw = localStorage.getItem(UNSETTLED_DISCARD_KEY);
        if (!raw) return Object.create(null);
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.create(null);
        const out: Record<string, UnsettledDiscardRecord> = Object.create(null);
        for (const [owner, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!value || typeof value !== 'object') continue;
            const { sessionId, userId, reason, savedAt } = value as Record<string, unknown>;
            if (!isBoundedString(sessionId) || !isBoundedString(userId) || !isBoundedString(reason) || userId !== owner) continue;
            out[owner] = { sessionId, userId, reason, savedAt: typeof savedAt === 'string' ? savedAt : '' };
        }
        return out;
    } catch {
        return Object.create(null);
    }
}

function writeAll(records: Record<string, UnsettledDiscardRecord>): void {
    try {
        if (Object.keys(records).length === 0) localStorage.removeItem(UNSETTLED_DISCARD_KEY);
        else localStorage.setItem(UNSETTLED_DISCARD_KEY, JSON.stringify(records));
    } catch {
        /* storage unavailable: the in-memory slot still offers Try again for this page */
    }
}

/** Records an unsettled discard for its owner. An ownerless take is never recorded (it could not be re-armed safely). */
export function saveUnsettledDiscardRecord(record: { sessionId: string; userId: string | null; reason: string }): void {
    const { sessionId, userId, reason } = record;
    if (!isBoundedString(userId) || !isBoundedString(sessionId) || !isBoundedString(reason)) return;
    const records = readAll();
    if (!Object.prototype.hasOwnProperty.call(records, userId) && Object.keys(records).length >= MAX_OWNERS) return;
    records[userId] = { sessionId, userId, reason, savedAt: new Date().toISOString() };
    writeAll(records);
}

/** The record, only when it belongs to exactly this signed-in owner. */
export function getUnsettledDiscardRecordForUser(userId: string | null | undefined): UnsettledDiscardRecord | null {
    if (!userId) return null;
    return readAll()[userId] ?? null;
}

/** Clears this owner's record only when it names this session, so another take's record is never removed. */
export function clearUnsettledDiscardRecord(userId: string | null | undefined, sessionId: string): void {
    if (!userId) return;
    const records = readAll();
    if (records[userId]?.sessionId !== sessionId) return;
    delete records[userId];
    writeAll(records);
}
