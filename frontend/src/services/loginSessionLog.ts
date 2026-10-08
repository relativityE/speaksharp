/**
 * Share feedback — the practice sessions SAVED DURING THIS LOGIN (FEEDBACK_SESSION_SELECTOR_SPEC §5; pre-RWT, #1541).
 *
 * The dialog's optional "Which session is this about?" field lists these, newest first. An entry is recorded once, at the
 * controller's single confirmed-save boundary (§5.2), never on Start, Stop, an attempted or a failed/discarded save.
 *
 * Stored in THIS TAB's `sessionStorage` (never `localStorage`), so a reload in the same login keeps the numbering. Every read
 * checks the owner AND the login it belongs to (`loginStartedAt` — the server's sign-in time for the current auth session,
 * which a token refresh does not change and a new sign-in does); a mismatch removes the key and returns []. `AuthProvider`
 * clears it on sign-out and account change, in the same place it clears the feedback draft. If storage is unavailable, an
 * in-memory list serves the tab's lifetime; after a reload it is empty and no numbers are invented.
 *
 * Only the saved session's own id is kept (as `key`), with its save-order number, product and save time. Nothing the person
 * said or typed.
 */

export interface LoginSessionEntry {
    key: string;                         // the saved session's id; used only as the <option> value and payload
    n: number;                           // 1-based, in save order within this login
    product: 'open_mic' | 'focus_points';
    savedAt: number;                     // epoch ms, client clock at save success
}

export const LOGIN_SESSION_LOG_KEY = 'feedback.loginSessions';

interface Stored { ownerId: string; loginStartedAt: number; entries: LoginSessionEntry[] }

let memory: Stored | null = null;
/**
 * #1541 Codex P2 r4126402535 — storage can be READABLE but not WRITABLE (quota, browser policy). After any failed write
 * the in-memory copy holds the newest log, so this tab reads and writes memory from then on; otherwise the next read
 * would return the stale stored value and a confirmed save would vanish from the selector. Reset by clearLoginSessions.
 */
let writeFailed = false;

const storage = (): Storage | null => {
    if (writeFailed) return null;
    try {
        const s = globalThis.sessionStorage;
        s.getItem(LOGIN_SESSION_LOG_KEY);   // probes access (private modes can throw here)
        return s;
    } catch {
        return null;
    }
};

const parse = (raw: unknown): Stored | null => {
    const v = raw as Partial<Stored> | null;
    if (!v || typeof v.ownerId !== 'string' || typeof v.loginStartedAt !== 'number' || !Array.isArray(v.entries)) return null;
    const entries = v.entries.filter((e): e is LoginSessionEntry => {
        const x = e as Partial<LoginSessionEntry> | null;
        return !!x && typeof x.key === 'string' && x.key.length > 0 && typeof x.n === 'number' && Number.isInteger(x.n) && x.n > 0
            && (x.product === 'open_mic' || x.product === 'focus_points') && typeof x.savedAt === 'number';
    });
    return { ownerId: v.ownerId, loginStartedAt: v.loginStartedAt, entries };
};

const load = (): Stored | null => {
    const s = storage();
    if (!s) return memory;
    try {
        const raw = s.getItem(LOGIN_SESSION_LOG_KEY);
        return raw ? parse(JSON.parse(raw)) : null;
    } catch {
        return null;   // malformed JSON is dropped, never thrown
    }
};

const save = (value: Stored): void => {
    const s = storage();
    if (!s) { memory = value; return; }
    try { s.setItem(LOGIN_SESSION_LOG_KEY, JSON.stringify(value)); } catch { memory = value; writeFailed = true; }
};

/** This login's entries in save order; [] (and the stored list removed) if the owner or login differs. */
export function readLoginSessions(ownerId: string | null, loginStartedAt: number | null): LoginSessionEntry[] {
    const stored = load();
    if (!stored) return [];
    if (ownerId === null || loginStartedAt === null || stored.ownerId !== ownerId || stored.loginStartedAt !== loginStartedAt) {
        clearLoginSessions();
        return [];
    }
    return stored.entries;
}

/** Record one confirmed save. `n` is assigned here (entries.length + 1); a repeated key is ignored. */
export function recordSavedSession(ownerId: string, loginStartedAt: number, entry: Omit<LoginSessionEntry, 'n'>): void {
    if (!ownerId || !entry.key) return;
    const entries = readLoginSessions(ownerId, loginStartedAt);
    if (entries.some((e) => e.key === entry.key)) return;
    save({ ownerId, loginStartedAt, entries: [...entries, { ...entry, n: entries.length + 1 }] });
}

export function clearLoginSessions(): void {
    memory = null;
    writeFailed = false;
    try { globalThis.sessionStorage.removeItem(LOGIN_SESSION_LOG_KEY); } catch { /* storage is optional */ }
}

/**
 * The login the app is currently in, set by `AuthProvider` whenever it applies a session, so the controller's save boundary
 * (which has no auth context) can record against it. `loginStartedAt` is the server's sign-in time (`user.last_sign_in_at`):
 * unchanged by a token refresh or a page reload, new on every sign-in.
 */
let current: { ownerId: string; loginStartedAt: number } | null = null;   // a LoginIdentity

export function loginStartedAtOf(session: { user?: { last_sign_in_at?: string | null } | null } | null): number | null {
    const at = session?.user?.last_sign_in_at ? Date.parse(session.user.last_sign_in_at) : NaN;
    return Number.isFinite(at) ? at : null;
}

let currentOwner: string | null = null;
let appliedKey = '';
let epoch = 0;

export function setCurrentLogin(ownerId: string | null, loginStartedAt: number | null): void {
    current = ownerId && loginStartedAt !== null ? { ownerId, loginStartedAt } : null;
    currentOwner = ownerId || null;
    const key = `${currentOwner ?? ''}|${loginStartedAt ?? ''}`;
    if (key !== appliedKey) { appliedKey = key; epoch += 1; }
}

/**
 * #1573 (Codex P1 4223017340): advances on EVERY applied identity change — sign-in, sign-out, account switch — even when
 * the sign-in time is unknown (no LoginIdentity). Async work bound to an epoch is discarded once it moves. A token refresh
 * re-applies the same owner and sign-in time, so it does not move.
 */
export function authEpoch(): number {
    return epoch;
}

/** The signed-in owner as last applied by AuthProvider (null when signed out), with or without a sign-in time. */
export function currentOwnerId(): string | null {
    return currentOwner;
}

export function currentLogin(): { ownerId: string; loginStartedAt: number } | null {
    return current;
}

export type LoginIdentity = { ownerId: string; loginStartedAt: number };

/**
 * The controller's confirmed-save hook (#1541 Codex P1 r4127289522). `recordingLogin` is the login captured when the
 * recording began (or when a same-owner Retry Save was rehydrated), NOT the login current when the save completes: a save
 * finishing after an account switch belongs to the account that recorded it. The entry is recorded only if that login is
 * still the current one; after a switch or a new sign-in nothing is recorded, so no login ever lists another's session.
 */
export function recordSavedSessionFor(recordingLogin: LoginIdentity | null, entry: Omit<LoginSessionEntry, 'n'>): void {
    if (!recordingLogin || !current) return;
    if (current.ownerId !== recordingLogin.ownerId || current.loginStartedAt !== recordingLogin.loginStartedAt) return;
    recordSavedSession(recordingLogin.ownerId, recordingLogin.loginStartedAt, entry);
}
