/**
 * J1.d — the returning user signs out and comes back, on J1.a's run-owned account and its known saved takes (Sam, 16 Nov).
 * J1.d is the canonical owner of these rows; the nightly invocation is `J1D`. There is no legacy execution path, home or
 * fallback: no AHT-15 receipt can satisfy J1.d.
 *
 * Order (Sam): establish the owner and history → sign out through the app while the sign-out recorder observes → from the
 * signed-out browser open a known take's deep link → sign back in as the same owner → the exact requested detail renders and
 * the known takes still reopen → the mic stays off on return and on the deep link, and nothing records or writes a session →
 * finish signed out. No signup, no maintained account, no injected prior bearer.
 *
 * Pure decisions only (no Playwright): every rule is unit-tested with its failing controls in tests/unit/rwtJ1dJourney.test.ts.
 * Missing or ambiguous evidence is HOLD, never PASS. Receipts are content-free: digests, counts and booleans only.
 */
import { createHash } from 'node:crypto';
import type { Verdict } from './rwtAbandonTakeover';
import { routeOf, SIGNOUT_STALE_REQUEST_ROW, SIGNOUT_UNAUTHORIZED_READ_ROW, type SignOutObservation, signOutStaleRequestVerdict,
    signOutUnauthorizedReadVerdict } from './rwtSignOutRecorder';

export const J1D_SUITE = 'returning-signout-j1d';
export const J1D_LEG = 'J1.d' as const;
/** J1.d's native rows, in plan order. tests/unit/rwtJ1dJourney.test.ts pins them to journey-plan.cjs NATIVE_LEG_ROWS. */
export const J1D_ROWS = Object.freeze([
    'history-preserved', 'switches-mic-off', 'signed-out', 'return-owner-preserved', 'no-recording-or-session-write',
    'return-entry-mic-off', 'deep-link-exact-return', 'deep-link-rendered-own-detail', 'deep-link-mic-off', 'return-signed-out',
    SIGNOUT_UNAUTHORIZED_READ_ROW, SIGNOUT_STALE_REQUEST_ROW,
] as const);
export type J1dRow = (typeof J1D_ROWS)[number];

export const digestOf = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Admission: J1.d runs only under the named nine-journey runner, in J1.a's worker (Sam 1a), on the account J1.a created in THIS
 * run. The record names the J1D suite, this run and attempt, `reusesLeg: 'J1.a'` and J1.a's non-secret lookup reference, which the
 * spec must match to the account it holds. J1.a's known takes come from J1.a in memory, never from the record. A record that
 * carries an account-create attempt is refused: J1.d never signs up.
 */
export type J1dAdmission = { admitted: true; lookupRef: string } | { admitted: false; reason: string };
export const J1D_ADMISSION_ENV = 'RWT_J1D_RUNNER_ADMISSION';
const LOOKUP_REF = /^rwt-journey-[a-z0-9-]{4,80}@[a-z0-9.-]+\.[a-z]{2,}$/;
export function j1dRunnerAdmission(env: Readonly<Record<string, string | undefined>>, readFile: (p: string) => string): J1dAdmission {
    const file = env[J1D_ADMISSION_ENV];
    if (!file) return { admitted: false, reason: `no named-runner admission (${J1D_ADMISSION_ENV} is not set); J1.d never runs standalone` };
    let doc: Record<string, unknown>;
    try { doc = JSON.parse(readFile(file)) as Record<string, unknown>; } catch { return { admitted: false, reason: 'the runner admission record is unreadable' }; }
    if (doc?.suite !== J1D_SUITE) return { admitted: false, reason: 'the runner admission does not name the J1D suite' };
    if (!env.GITHUB_RUN_ID || doc.runId !== env.GITHUB_RUN_ID || doc.runAttempt !== env.GITHUB_RUN_ATTEMPT) {
        return { admitted: false, reason: 'the runner admission is not bound to this run and attempt' };
    }
    if (doc.createAttempt !== undefined) return { admitted: false, reason: 'J1.d never signs up: an admission carrying an account-create attempt is refused' };
    if (doc.reusesLeg !== 'J1.a') return { admitted: false, reason: 'J1.d runs only on the account J1.a created in this run' };
    if (typeof doc.lookupRef !== 'string' || !LOOKUP_REF.test(doc.lookupRef)) {
        return { admitted: false, reason: 'the runner admission names no run-owned J1.a account' };
    }
    return { admitted: true, lookupRef: doc.lookupRef };
}

/** The microphone and recorder state on one page at one moment: null when it could not be read. */
export interface MicState { recording: boolean | null; liveTracks: number | null }
const micOff = (m: MicState | null, where: string): Verdict => {
    if (!m || m.recording === null || m.liveTracks === null) return { status: 'HOLD', detail: `the microphone state ${where} was not observed` };
    if (m.recording || m.liveTracks > 0) return { status: 'FAIL', detail: `the microphone was live ${where} (recording ${m.recording}, ${m.liveTracks} live track(s))` };
    return { status: 'PASS', detail: `the microphone stayed off ${where}` };
};

/** Everything the J1D spec observed, as content-free facts. Every field is null when it was not observed. */
export interface J1dObservations {
    /** J1.a's known saved takes (digests), from J1.a in memory. */
    knownTakeDigests: readonly string[];
    /** The signed-in owner before sign-out, and after the return (digest of the user id the page's session names). */
    ownerBefore: string | null;
    ownerAfterReturn: string | null;
    /** Take digests listed in history after the return, and which known takes reopened to their own detail. */
    listedAfterReturn: readonly string[] | null;
    reopened: Readonly<Record<string, boolean>> | null;
    /** The mic on the page that signed out, just after sign-out completed. */
    micAfterSignOut: MicState | null;
    /** Sign-out: the app's logout completed (2xx) and, afterwards, the page held no session. */
    signOut: { logoutCompleted: boolean | null; sessionAfter: boolean | null } | null;
    /** The deep link requested from the signed-out browser, and where the page landed after signing back in (path + query). */
    deepLink: { requested: string | null; landed: string | null } | null;
    /** The detail the deep link rendered: which take and which owner (digests); null when nothing identifiable rendered. */
    rendered: { takeDigest: string | null; ownerDigest: string | null } | null;
    /** The requested take (digest): one of the known takes. */
    requestedTakeDigest: string | null;
    micAtReturnEntry: MicState | null;
    micOnDeepLink: MicState | null;
    /** Recording starts and session writes (INSERT/UPDATE on sessions) seen from first sign-in to the end; complete only when closed. */
    writes: { recordingStarts: number; sessionWrites: number; windowClosed: boolean } | null;
    /** The final sign-out: completed, and no session afterwards. */
    finalSignOut: { logoutCompleted: boolean | null; sessionAfter: boolean | null } | null;
    /** The sign-out recorder's observation for the first sign-out. */
    recorder: SignOutObservation | null;
}

const signedOutVerdict = (s: J1dObservations['signOut'], what: string): Verdict => {
    if (!s || s.logoutCompleted === null || s.sessionAfter === null) return { status: 'HOLD', detail: `${what} was not observed` };
    if (!s.logoutCompleted) return { status: 'FAIL', detail: `${what}: the app's logout did not complete` };
    if (s.sessionAfter) return { status: 'FAIL', detail: `${what}: a session remained after logout` };
    return { status: 'PASS', detail: `${what}: logout completed and no session remained` };
};

export function historyPreservedVerdict(o: J1dObservations): Verdict {
    if (o.knownTakeDigests.length === 0) return { status: 'HOLD', detail: 'no known saved takes to check' };
    if (o.listedAfterReturn === null || o.reopened === null) return { status: 'HOLD', detail: 'the history after the return was not observed' };
    const missing = o.knownTakeDigests.filter((t) => !o.listedAfterReturn!.includes(t));
    if (missing.length > 0) return { status: 'FAIL', detail: `${missing.length} known take(s) missing from the history after the return` };
    const unopened = o.knownTakeDigests.filter((t) => o.reopened![t] !== true);
    if (unopened.some((t) => o.reopened![t] === false)) return { status: 'FAIL', detail: 'a known take did not reopen to its own detail' };
    if (unopened.length > 0) return { status: 'HOLD', detail: 'not every known take was reopened' };
    return { status: 'PASS', detail: `all ${o.knownTakeDigests.length} known take(s) are listed and reopen after the return` };
}

export function returnOwnerPreservedVerdict(o: J1dObservations): Verdict {
    if (!o.ownerBefore || !o.ownerAfterReturn) return { status: 'HOLD', detail: 'the owner before sign-out or after the return was not observed' };
    if (o.ownerBefore !== o.ownerAfterReturn) return { status: 'FAIL', detail: 'the return signed in as a different owner' };
    return { status: 'PASS', detail: 'the return signed back in as the same owner' };
}

export function noRecordingOrSessionWriteVerdict(o: J1dObservations): Verdict {
    const w = o.writes;
    if (!w) return { status: 'HOLD', detail: 'recording starts and session writes were not observed' };
    if (w.recordingStarts > 0 || w.sessionWrites > 0) {
        return { status: 'FAIL', detail: `the journey recorded or wrote a session (${w.recordingStarts} recording start(s), ${w.sessionWrites} session write(s))` };
    }
    if (!w.windowClosed) return { status: 'HOLD', detail: 'the write window was not closed, so a late write cannot be ruled out' };
    return { status: 'PASS', detail: 'no recording started and no session was written' };
}

export function deepLinkExactReturnVerdict(o: J1dObservations): Verdict {
    const d = o.deepLink;
    if (!d || !d.requested || !d.landed) return { status: 'HOLD', detail: 'the requested deep link or the landing after sign-in was not observed' };
    if (d.requested !== d.landed) return { status: 'FAIL', detail: 'signing back in did not return to the exact requested deep link' };
    return { status: 'PASS', detail: 'signing back in returned to the exact requested deep link' };
}

/** Sam: an arbitrary nonempty list or a generic detail is not proof. Only the requested take, rendered for its owner, passes. */
export function deepLinkRenderedOwnDetailVerdict(o: J1dObservations): Verdict {
    const r = o.rendered;
    if (!o.requestedTakeDigest || !o.knownTakeDigests.includes(o.requestedTakeDigest)) {
        return { status: 'HOLD', detail: 'the deep link did not name one of the known takes' };
    }
    if (!r || !r.takeDigest || !r.ownerDigest || !o.ownerBefore) return { status: 'HOLD', detail: 'no identifiable take detail rendered for the deep link' };
    if (r.takeDigest !== o.requestedTakeDigest) return { status: 'FAIL', detail: 'the deep link rendered a different take than the one requested' };
    if (r.ownerDigest !== o.ownerBefore) return { status: 'FAIL', detail: 'the deep link rendered a take for another owner' };
    return { status: 'PASS', detail: 'the deep link rendered the requested take for its own owner' };
}

/** Every J1.d row's verdict. Exactly the J1D rows, each present; a row with no evidence is HOLD. */
export function j1dVerdicts(o: J1dObservations): Readonly<Record<J1dRow, Verdict>> {
    const fromRecorder = (f: (x: SignOutObservation) => Verdict): Verdict => (o.recorder ? f(o.recorder) : { status: 'HOLD', detail: 'the sign-out recorder did not observe the sign-out' });
    return Object.freeze({
        'history-preserved': historyPreservedVerdict(o),
        'switches-mic-off': micOff(o.micAfterSignOut, 'after sign-out'),
        'signed-out': signedOutVerdict(o.signOut, 'sign-out'),
        'return-owner-preserved': returnOwnerPreservedVerdict(o),
        'no-recording-or-session-write': noRecordingOrSessionWriteVerdict(o),
        'return-entry-mic-off': micOff(o.micAtReturnEntry, 'on return'),
        'deep-link-exact-return': deepLinkExactReturnVerdict(o),
        'deep-link-rendered-own-detail': deepLinkRenderedOwnDetailVerdict(o),
        'deep-link-mic-off': micOff(o.micOnDeepLink, 'on the deep link'),
        'return-signed-out': signedOutVerdict(o.finalSignOut, 'the final sign-out'),
        [SIGNOUT_UNAUTHORIZED_READ_ROW]: fromRecorder(signOutUnauthorizedReadVerdict),
        [SIGNOUT_STALE_REQUEST_ROW]: fromRecorder(signOutStaleRequestVerdict),
    } as Record<J1dRow, Verdict>);
}

/** The J1D invocation result rows the nightly splitter places: native `J1.d:<row>` on leg J1.d, outcomes only. */
export function j1dCaseAssertions(verdicts: Readonly<Record<J1dRow, Verdict>>): ReadonlyArray<{ id: string; leg: 'J1.d'; result: Verdict['status'] }> {
    return J1D_ROWS.map((row) => ({ id: `${J1D_LEG}:${row}`, leg: J1D_LEG, result: verdicts[row]?.status ?? 'HOLD' }));
}

/** The part of a Playwright page the loaded-review read needs (kept structural so this module stays free of Playwright). */
export interface ReviewPage {
    getByTestId(id: string): { first(): { getAttribute(name: string, options?: { timeout?: number }): Promise<string | null> } };
    waitForTimeout(ms: number): Promise<void>;
}

/**
 * Matched on the FULL pathname: `routeOf()` keeps three segments, so every RPC collapses to `/rest/v1/rpc` (Codex, #1883). The
 * sessions table matches by route, so a row path (`/rest/v1/sessions/...`) still counts.
 */
const SESSION_WRITE_RPCS = new Set(['/rest/v1/rpc/create_session_and_update_usage', '/rest/v1/rpc/heartbeat_session']);
const SESSION_TABLE_ROUTE = '/rest/v1/sessions';
const RECORDING_START_RPC = '/rest/v1/rpc/acquire_recording_lease';
/** Exported for its unit test: is this request a session write, or a recording start? */
export function classifyJourneyWrite(method: string, pathname: string): 'session-write' | 'recording-start' | null {
    const path = pathname.replace(/\/+$/, '');
    if (path === RECORDING_START_RPC) return 'recording-start';
    if (method === 'GET' || method === 'HEAD') return null;
    if (SESSION_WRITE_RPCS.has(path) || routeOf(path) === SESSION_TABLE_ROUTE) return 'session-write';
    return null;
}

/**
 * The take the saved review was actually read from. The section renders while its read is in flight, without
 * `data-session-id` (Codex, #1883), so wait for the loaded id itself, never for visibility alone. null: nothing loaded in time.
 */
export async function loadedReviewSessionId(page: ReviewPage, timeoutMs = 45_000, now: () => number = Date.now): Promise<string | null> {
    const review = page.getByTestId('saved-review').first();
    // The attribute read returns at once while the review loads, so the wait is the elapsed-time deadline (Codex, #1883). The
    // attempt cap only stops a frozen clock: each real attempt waits at least POLL_MS, so it never ends the wait early.
    const POLL_MS = 250;
    const deadline = now() + timeoutMs;
    const cap = Math.ceil(timeoutMs / POLL_MS) + 1;
    for (let i = 0; i < cap && now() < deadline; i += 1) {
        const id = await review.getAttribute('data-session-id', { timeout: 1_000 }).catch(() => null);
        if (id) return id;
        await page.waitForTimeout(POLL_MS);
    }
    return null;
}
