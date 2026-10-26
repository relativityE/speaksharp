/**
 * #1045 — the single "open" recommendation attempt the user accepted with "Practice this next", pending
 * the next session that will resolve it. Owner-scoped, localStorage-backed so it survives navigation into
 * the recording surface and a reload. Exactly one open attempt at a time (accepting a new one replaces it).
 */
import logger from '@/lib/logger';

const KEY = 'ss_progress_open_attempt_v1';
const listeners = new Set<() => void>();
const notify = () => {
    for (const listener of listeners) {
        try { listener(); } catch { /* An observer cannot change the durable write's outcome. */ }
    }
};

export interface RepeatTargetReference {
    version: 1;
    criterion: 'repeat_cached_instruction_v1';
    product: 'open_mic' | 'focus_points';
    instructionHash: string;
    focus?: { projectId: string; briefId: string; setHash: string };
}
type UnavailableReference = { version: 'unavailable' };
const identity = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** Explicit serialization allowlist: no caller-supplied instruction/topic/labels can reach persistence. */
export function sanitizeRepeatTarget(value: unknown): RepeatTargetReference | UnavailableReference | undefined {
    if (value === undefined) return undefined;
    const v = value as Partial<RepeatTargetReference> | null;
    if (!v || v.version !== 1 || v.criterion !== 'repeat_cached_instruction_v1' || !digest(v.instructionHash)
        || (v.product !== 'open_mic' && v.product !== 'focus_points')) return { version: 'unavailable' };
    if (v.product === 'open_mic') return { version: 1, criterion: v.criterion, product: v.product, instructionHash: v.instructionHash };
    if (!v.focus || !identity(v.focus.projectId) || !identity(v.focus.briefId) || !digest(v.focus.setHash)) return { version: 'unavailable' };
    return { version: 1, criterion: v.criterion, product: v.product, instructionHash: v.instructionHash,
        focus: { projectId: v.focus.projectId, briefId: v.focus.briefId, setHash: v.focus.setHash } };
}

export interface OpenAttempt {
    attemptId: string;
    userId: string;
    /** The session the recommendation was shown on — for observability only; comparability is server-side. */
    sourceSessionId: string;
    /** Once resolution starts, retries remain durably bound to this exact repeat session. */
    resolutionSessionId?: string;
    /**
     * #1258 RH-13: when the user accepted it. A reconcile round binds the attempt only to the first owed take enqueued
     * after this moment; an attempt stored before this field existed is bound by the next save, as before.
     */
    acceptedAtIso?: string;
    repeatTarget?: RepeatTargetReference | UnavailableReference;
}

export function openAttemptSnapshot(): string | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY); } catch { return null; }
}

export function subscribeOpenAttempt(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function setOpenAttempt(a: OpenAttempt): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
        const safe: OpenAttempt = { attemptId: a.attemptId, userId: a.userId, sourceSessionId: a.sourceSessionId,
            ...(a.acceptedAtIso === undefined ? {} : { acceptedAtIso: a.acceptedAtIso }),
            ...(a.resolutionSessionId === undefined ? {} : { resolutionSessionId: a.resolutionSessionId }),
            ...(a.repeatTarget === undefined ? {} : { repeatTarget: sanitizeRepeatTarget(a.repeatTarget) }) };
        const raw = JSON.stringify(safe);
        localStorage.setItem(KEY, raw);
        const stored = localStorage.getItem(KEY) === raw;
        notify();
        return stored && localStorage.getItem(KEY) === raw;
    } catch (err) {
        logger.warn({ err }, '[progress] open-attempt write failed');
        return false;
    }
}

export function getOpenAttemptForUser(userId: string): OpenAttempt | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const a = JSON.parse(raw) as OpenAttempt;
        if (a && a.userId === userId && typeof a.attemptId === 'string') return {
            attemptId: a.attemptId, userId: a.userId, sourceSessionId: a.sourceSessionId,
            ...(a.acceptedAtIso === undefined ? {} : { acceptedAtIso: a.acceptedAtIso }),
            ...(a.resolutionSessionId === undefined ? {} : { resolutionSessionId: a.resolutionSessionId }),
            ...(a.repeatTarget === undefined ? {} : { repeatTarget: sanitizeRepeatTarget(a.repeatTarget) }),
        };
        return null;
    } catch { return null; }
}

export function clearOpenAttempt(): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(KEY); notify(); } catch { /* ignore */ }
}

/** Clear only the handoff this caller terminally closed; never erase a newer replacement binding. */
export function clearOpenAttemptIfMatches(userId: string, attemptId: string): boolean {
    const current = getOpenAttemptForUser(userId);
    if (!current || current.attemptId !== attemptId) return false;
    if (typeof localStorage === 'undefined') return false;
    try {
        localStorage.removeItem(KEY);
        notify();
        // Only claim success after authoritative browser-storage readback proves absence.
        return localStorage.getItem(KEY) === null;
    } catch (err) {
        logger.warn({ err, attemptId }, '[progress] matching open-attempt clear failed');
        return false;
    }
}
