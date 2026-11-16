/**
 * AHT-15 (returning user and Products navigation) — case-only verdicts for the rows the review (fifteen-case front-run,
 * 2026-11-10) found partial or missing:
 *
 *  - `history preserved` / `navigation writes nothing` / `deep-link return writes nothing`: the account's session ROWS are
 *    compared by identity (id) and content-free facts (status, transcript_state, transcript length, a digest of the trimmed
 *    transcript, idempotency-key presence, created_at), never by count alone. A status flip, or a write followed by a delete,
 *    keeps the count and still FAILs here. Transcript text is hashed in Node the moment it is read and never kept; only counts
 *    of added, removed and changed rows reach a receipt.
 *  - `no mic on return entry`: an explicit read of the microphone the moment the returning user lands (counter installed,
 *    acquisitions, live tracks, recorder controls, runtime state), instead of an inference from the end-of-journey count.
 *  - `signed-in deep-link rendered own detail`: after the deep-link return, the session detail shows THAT session's own saved
 *    transcript. The rendered text is digested IN THE PAGE (sha256 of `innerText.trim()`), so only a digest leaves the browser;
 *    it is compared with the digest of the admin-read transcript. With no session whose transcript is available, HOLD.
 *
 * Every verdict fails closed: an unread, malformed or partial observation is HOLD, never PASS.
 */
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';

export type RowVerdict = 'PASS' | 'FAIL' | 'HOLD';
export type Evidence = Record<string, string | number | boolean | null>;
export interface RowResult { verdict: RowVerdict; detail: string; evidence: Evidence }

/** One session row, content-free. `transcriptDigest` is sha256(hex) of the trimmed transcript, null when none is usable. */
export interface SessionRowFacts {
    id: string;
    status: string | null;
    transcriptState: string | null;
    transcriptLength: number;
    transcriptDigest: string | null;
    hasIdempotencyKey: boolean;
    createdAt: string | null;
}

/** The columns `sessionFactsFromRows` reads. Callers select exactly these, ordered by created_at then id. */
export const SESSION_FACT_COLUMNS = 'id,status,transcript_state,transcript,idempotency_key,created_at';

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');
const DIGEST = /^[0-9a-f]{64}$/;

/**
 * The admin read's rows as content-free facts, in the order given, or null when the read is not a list of rows that each carry
 * a distinct non-empty string id (an unreadable read is never an empty history).
 */
export function sessionFactsFromRows(data: unknown): SessionRowFacts[] | null {
    if (!Array.isArray(data)) return null;
    const seen = new Set<string>();
    const facts: SessionRowFacts[] = [];
    for (const raw of data) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const r = raw as Record<string, unknown>;
        if (typeof r.id !== 'string' || r.id.length === 0 || seen.has(r.id)) return null;
        seen.add(r.id);
        const transcript = typeof r.transcript === 'string' ? r.transcript : null;
        const trimmed = transcript?.trim() ?? '';
        facts.push({
            id: r.id,
            status: typeof r.status === 'string' ? r.status : null,
            transcriptState: typeof r.transcript_state === 'string' ? r.transcript_state : null,
            transcriptLength: transcript?.length ?? 0,
            transcriptDigest: trimmed.length > 0 ? sha256Hex(trimmed) : null,
            hasIdempotencyKey: typeof r.idempotency_key === 'string' && r.idempotency_key.length > 0,
            createdAt: typeof r.created_at === 'string' ? r.created_at : null,
        });
    }
    return facts;
}

const sameFacts = (a: SessionRowFacts, b: SessionRowFacts): boolean => a.status === b.status && a.transcriptState === b.transcriptState
    && a.transcriptLength === b.transcriptLength && a.transcriptDigest === b.transcriptDigest
    && a.hasIdempotencyKey === b.hasIdempotencyKey && a.createdAt === b.createdAt;

/** Rows present only after (added), only before (removed), and present in both with any differing fact (changed). */
export function compareSessionRows(before: readonly SessionRowFacts[], after: readonly SessionRowFacts[]): { added: number; removed: number; changed: number } {
    const was = new Map(before.map((r) => [r.id, r]));
    const now = new Map(after.map((r) => [r.id, r]));
    let changed = 0;
    for (const [id, r] of now) { const old = was.get(id); if (old && !sameFacts(old, r)) changed += 1; }
    return {
        added: [...now.keys()].filter((id) => !was.has(id)).length,
        removed: [...was.keys()].filter((id) => !now.has(id)).length,
        changed,
    };
}

const completed = (rows: readonly SessionRowFacts[]): number => rows.filter((r) => r.status === 'completed').length;
const diffEvidence = (before: readonly SessionRowFacts[], after: readonly SessionRowFacts[]): Evidence =>
    ({ rowsBefore: before.length, rowsAfter: after.length, ...compareSessionRows(before, after) });

/**
 * `navigation writes nothing` / `deep-link return writes nothing`: the account's session rows after the step are exactly the
 * baseline's (same ids, same content-free facts). Either read missing is HOLD.
 */
export function sessionWritesVerdict(before: readonly SessionRowFacts[] | null, after: readonly SessionRowFacts[] | null): RowResult {
    if (!before || !after) {
        return { verdict: 'HOLD', detail: 'the session rows could not be read before and after, so writes are unverified', evidence: { baselineRead: Boolean(before), afterRead: Boolean(after) } };
    }
    const d = compareSessionRows(before, after);
    const evidence = diffEvidence(before, after);
    return d.added + d.removed + d.changed === 0
        ? { verdict: 'PASS', detail: 'navigation created, removed and changed no session row (ids and content-free facts unchanged)', evidence }
        : { verdict: 'FAIL', detail: 'a session row was created, removed or changed during navigation', evidence };
}

/**
 * `history preserved`: the history the returning user signed in with is unchanged when Progress shows it (row identities and
 * content-free facts), and, when the account has a session with an available transcript (the rendered-detail target), Progress
 * lists that session's own Open control. No completed baseline history is HOLD (nothing to preserve).
 */
export function historyPreservedVerdict(
    before: readonly SessionRowFacts[] | null, after: readonly SessionRowFacts[] | null, ownTargetListed: boolean | null,
): RowResult {
    if (!before || !after) {
        return { verdict: 'HOLD', detail: 'the session rows could not be read at sign-in and on Progress, so history is unverified', evidence: { baselineRead: Boolean(before), progressRead: Boolean(after) } };
    }
    const evidence = { ...diffEvidence(before, after), completedBefore: completed(before), ownTargetListed };
    if (completed(before) === 0) return { verdict: 'HOLD', detail: 'the account had no completed session at sign-in, so there is no history to preserve', evidence };
    const d = compareSessionRows(before, after);
    if (d.added + d.removed + d.changed !== 0) return { verdict: 'FAIL', detail: 'the history changed between sign-in and Progress', evidence };
    if (ownTargetListed === false) return { verdict: 'FAIL', detail: 'Progress does not list the account\'s own session with an available transcript', evidence };
    return { verdict: 'PASS', detail: ownTargetListed ? 'the history is unchanged and Progress lists the own target session'
        : 'the history is unchanged (no session with an available transcript to look for in the list)', evidence };
}

/**
 * The deep-link target: the NEWEST (last, in the caller's created_at order) completed session whose transcript is available
 * and non-empty, with its digest; otherwise the newest completed session for the routing alone (no digest: the rendered row
 * HOLDs); null when the account has no completed session.
 */
export function deepLinkTarget(rows: readonly SessionRowFacts[]): { id: string; expectedDigest: string | null } | null {
    const done = rows.filter((r) => r.status === 'completed');
    const readable = done.filter((r) => r.transcriptState === 'available' && r.transcriptDigest !== null);
    const own = readable[readable.length - 1];
    if (own) return { id: own.id, expectedDigest: own.transcriptDigest };
    const newest = done[done.length - 1];
    return newest ? { id: newest.id, expectedDigest: null } : null;
}

/**
 * How many history rows Progress lists, newest first: `AnalyticsDashboard` "Recent sessions" renders
 * `sessionHistory.slice(0, 2)`, and `getSessionHistory` reads status completed-or-null, newest created_at first.
 */
export const PROGRESS_RECENT_ROWS = 2;

/**
 * The deep-link target (see `deepLinkTarget`) when Progress is expected to list it — it is among the newest
 * `PROGRESS_RECENT_ROWS` completed-or-null-status rows — so `history preserved` can require its Open control; null otherwise
 * (an older target is not on the list by design, and its listing is not judged).
 */
export function listedOwnTarget(rows: readonly SessionRowFacts[]): string | null {
    const target = deepLinkTarget(rows);
    if (!target || target.expectedDigest === null) return null;
    const recent = rows.filter((r) => r.status === 'completed' || r.status === null).slice(-PROGRESS_RECENT_ROWS);
    return recent.some((r) => r.id === target.id) ? target.id : null;
}

/** A read of the microphone at one moment: the acquisition counter (`installMicAcquisitionCounter`) and the visible recorder. */
export interface MicStateRead {
    counterInstalled: boolean;
    acquisitions: number;
    liveTracks: number;
    /** Every acquired track is `live` or `ended` (anything else makes the live count unreliable). */
    tracksWellFormed: boolean;
    recorderVisible: boolean;
    runtimeState: string | null;
    /** The document's identity (`performance.timeOrigin`), to bind this read to a later one. */
    document: number;
}

/** `no mic on return entry`: on landing, no acquisition, no live track, no recorder control and no RECORDING state. */
export function returnEntryMicVerdict(read: MicStateRead | null): RowResult {
    if (!read) return { verdict: 'HOLD', detail: 'the microphone state at the return entry could not be read', evidence: { observed: false } };
    const evidence: Evidence = {
        observed: true, counterInstalled: read.counterInstalled, acquisitions: read.acquisitions, liveTracks: read.liveTracks,
        recorderVisible: read.recorderVisible, recording: read.runtimeState === 'RECORDING',
    };
    if (!read.counterInstalled || !read.tracksWellFormed || !Number.isSafeInteger(read.acquisitions) || read.acquisitions < 0
        || !Number.isSafeInteger(read.liveTracks) || read.liveTracks < 0) {
        return { verdict: 'HOLD', detail: 'the microphone counter was absent or malformed at the return entry', evidence };
    }
    const off = read.acquisitions === 0 && read.liveTracks === 0 && !read.recorderVisible && read.runtimeState !== 'RECORDING';
    return off
        ? { verdict: 'PASS', detail: 'the returning user landed with the microphone off (no acquisition, live track or recorder)', evidence }
        : { verdict: 'FAIL', detail: 'the microphone was open, or a recorder was shown, when the returning user landed', evidence };
}

/** Reads the microphone state in the current document; null when the page cannot be read. */
export async function readMicState(page: Page): Promise<MicStateRead | null> {
    return page.evaluate(() => {
        const w = window as unknown as { __rwtMicAcquisitions__?: unknown; __rwtMicStreams__?: unknown };
        const media = navigator.mediaDevices;
        const original = media ? Object.getPrototypeOf(media)?.getUserMedia : undefined;
        const marks = w.__rwtMicAcquisitions__;
        const streams = w.__rwtMicStreams__;
        const counterInstalled = Boolean(media && Object.prototype.hasOwnProperty.call(media, 'getUserMedia') && media.getUserMedia !== original)
            && Array.isArray(marks) && Array.isArray(streams);
        const tracks = Array.isArray(streams) ? (streams as MediaStream[]).flatMap((s) => s.getAudioTracks()) : [];
        return {
            counterInstalled,
            acquisitions: Array.isArray(marks) ? marks.length : -1,
            liveTracks: tracks.filter((t) => t.readyState === 'live').length,
            tracksWellFormed: tracks.every((t) => t.readyState === 'live' || t.readyState === 'ended'),
            recorderVisible: Boolean(document.querySelector('[data-testid="recorder-bar"], [data-testid="recorder-stop"]')),
            runtimeState: document.documentElement.getAttribute('data-runtime-state'),
            document: performance.timeOrigin,
        };
    }).catch(() => null);
}

/** The routing outcome the rendered-detail check depends on: the deep-link row's verdict and whether the pathname matched. */
export interface DeepLinkRouting { verdict: RowVerdict; pathnameMatches: boolean }
/** The rendered session detail: the saved review and the transcript visible, and the in-page digest of the transcript. */
export interface RenderedDetailRead { reviewVisible: boolean; transcriptVisible: boolean; digest: string | null }

export const RENDERED_DETAIL_ROW = 'signed-in deep-link rendered own detail';

/**
 * `signed-in deep-link rendered own detail`: PASS only when the routing reached the target's own pathname, the saved review
 * and the transcript are visible, and the rendered transcript's digest equals the target's saved transcript digest.
 * No digest to compare (no available transcript), an unproven routing, or an unread page is HOLD.
 */
export function renderedOwnDetailVerdict(
    expectedDigest: string | null, routing: DeepLinkRouting | null, read: RenderedDetailRead | null,
): RowResult {
    const base: Evidence = { comparable: expectedDigest !== null, routing: routing?.verdict ?? 'not_reached' };
    if (expectedDigest === null || !DIGEST.test(expectedDigest)) {
        return { verdict: 'HOLD', detail: 'the account has no completed session with an available transcript, so the rendered detail cannot be compared', evidence: base };
    }
    if (!routing || routing.verdict === 'HOLD') return { verdict: 'HOLD', detail: 'the deep-link return was not proven, so its rendered detail is not judged', evidence: base };
    if (!read) return { verdict: 'HOLD', detail: 'the rendered session detail could not be read', evidence: base };
    const evidence: Evidence = { ...base, pathnameMatches: routing.pathnameMatches, reviewVisible: read.reviewVisible,
        transcriptVisible: read.transcriptVisible, digestRead: read.digest !== null, matchesSaved: read.digest === expectedDigest };
    if (!routing.pathnameMatches) return { verdict: 'FAIL', detail: 'the deep-link return did not land on the target session\'s detail', evidence };
    if (!read.reviewVisible || !read.transcriptVisible) return { verdict: 'FAIL', detail: 'the session detail did not show the saved review and transcript', evidence };
    if (read.digest === null || !DIGEST.test(read.digest)) return { verdict: 'HOLD', detail: 'the rendered transcript could not be digested', evidence };
    return read.digest === expectedDigest
        ? { verdict: 'PASS', detail: 'the deep-linked detail shows that session\'s own saved transcript', evidence }
        : { verdict: 'FAIL', detail: 'the deep-linked detail shows a transcript other than that session\'s saved one', evidence };
}

/** The verdict, reading the page only when there is something to compare and the routing was proven. */
export async function renderedOwnDetailRow(
    expectedDigest: string | null, routing: DeepLinkRouting | null, read: () => Promise<RenderedDetailRead | null>,
): Promise<RowResult> {
    const needsRead = expectedDigest !== null && routing !== null && routing.verdict !== 'HOLD';
    return renderedOwnDetailVerdict(expectedDigest, routing, needsRead ? await read().catch(() => null) : null);
}

/** Waits (bounded) for the saved review and the transcript, then digests the transcript's `innerText.trim()` in the page. */
export async function readRenderedDetail(page: Page, timeoutMs = 45_000): Promise<RenderedDetailRead | null> {
    if (page.isClosed()) return null;
    const visible = (testId: string) => page.getByTestId(testId).first().waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true, () => false);
    const [reviewVisible, transcriptVisible] = await Promise.all([visible('saved-review'), visible('session-detail-transcript')]);
    const digest = transcriptVisible
        ? await page.getByTestId('session-detail-transcript').first().evaluate(async (el) => {
            const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode((el as HTMLElement).innerText.trim())));
            return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        }).catch(() => null)
        : null;
    return { reviewVisible, transcriptVisible, digest };
}
