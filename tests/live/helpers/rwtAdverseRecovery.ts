/**
 * AHT-12 / 13 / 14 (fifteen-case front-run review, 2026-11-10) — the pure verdicts behind the adverse journey's recovery,
 * reopen and mid-download gate (`rwtAdverseJourney.ts`). Free of Playwright so each rule is unit-tested with its failing
 * controls (tests/unit/rwtAdverseRecovery.test.ts). Inputs are content-free: states, ids, counts and SHA-256 digests.
 * Every row fails closed: a missing observation is HOLD, a contradiction is FAIL, and only a complete observation is PASS.
 */
import { createHash } from 'node:crypto';
import { type AdverseVariant, downloadFailureVerdict } from './rwtAdverse';
import { type SessionRowFacts, type Verdict, savedTakeReadbackVerdict } from './rwtSaveRetry';

/** The MicCard primary control the page offers (MicCard.tsx: `mic-download` cold, `mic-retry` failed setup, else `mic-start`). */
export const RECOVERY_CONTROL_IDS = ['mic-start', 'mic-download', 'mic-retry'] as const;
export type RecoveryControl = (typeof RECOVERY_CONTROL_IDS)[number];
export const isRecoveryControl = (id: unknown): id is RecoveryControl => (RECOVERY_CONTROL_IDS as readonly unknown[]).includes(id);

/**
 * The control each variant's recovery is DESIGNED to press first. AHT-12 recovers in a fresh allowing browser, whose page
 * offers the cold one-press `Download & start recording` (or Start when the model is already there). AHT-13/14 recover on the
 * failed page itself through `Retry Private setup` — and Retry only re-runs setup (MicCard.tsx: "retrying setup starts no
 * recording"), so a separate Start follows once the model is ready. Any other offered control is not this case's recovery.
 */
export const RECOVERY_CONTROLS: Readonly<Record<AdverseVariant, readonly RecoveryControl[]>> = Object.freeze({
    'mic-denied': Object.freeze(['mic-download', 'mic-start'] as const),
    'download-fails': Object.freeze(['mic-retry'] as const),
    'offline-mid-download': Object.freeze(['mic-retry'] as const),
});

/**
 * AHT-12 scope (Sam, 2026-11-11): the existing test is a FRESH-BROWSER STAND-IN. Two Starts: one denied Start in the first
 * browser, then one download-and-record activation in a fresh allowing browser (a third dummy press would contradict the app's
 * one-activation behaviour). It does not prove Allow → Retry on the original denied page. The catalog's full AHT-12 case
 * (assertion-catalog.json minimumStarts 3, same-context denial → grant → Retry) stays a SEPARATE, OPEN requirement: the catalog
 * is not changed to two, and no row here claims it.
 */
export const AHT12_STAND_IN_LABEL =
    'fresh-browser stand-in: same account, a fresh allowing browser; it does not prove Allow → Retry on the original denied page';
export const AHT12_CATALOG_CASE_OPEN =
    "the catalog's full AHT-12 case (three presses, same-context denial → grant → Retry) is a separate requirement this test does not meet";

const FAILED = new Set(['error', 'init-failed']);
export type RetrySetup = 'not-pressed' | 'ready' | 'failed-again' | 'pending' | 'unobserved';

/**
 * What Retry's setup did, from the COMPLETE model-status history published AFTER the Retry press (`readModelStatusLog`
 * sliced at the press; `null` when that history was not observed in this document). In order: `ready` first → ready; a
 * failed state after the setup had left the failed state → failed again; otherwise still pending. A history still reading
 * only the old failed state is pending, never "failed again" (the press has not been picked up yet).
 */
export function retrySetupOutcome(statusesAfterPress: readonly string[] | null): Exclude<RetrySetup, 'not-pressed'> {
    if (statusesAfterPress === null) return 'unobserved';
    let left = false;
    for (const s of statusesAfterPress) {
        if (s === 'ready') return 'ready';
        if (FAILED.has(s)) { if (left) return 'failed-again'; continue; }
        left = true;
    }
    return 'pending';
}

/** What the journey's recovery presses observed. `startEnabled` is null when no Start was due. */
export interface RecoveryAttempt {
    offered: RecoveryControl | null;
    retry: RetrySetup;
    startEnabled: boolean | null;
    recorded: boolean;
}

/**
 * deliberate-recovery-saved / allowed-recovery-saved, at the harness's `ownSaved` bar (source-adapters.cjs `ownSaved`): the
 * designed recovery control was offered and pressed, Retry (13/14) brought the model to ready before Start, a take recorded,
 * and the account's new rows are EXACTLY one row — the page-bound id, completed, with an idempotency key and an available,
 * non-empty transcript (`savedTakeReadbackVerdict`, unchanged). `preconditionEstablished` false (13/14: the failed download was
 * not stated with Retry) turns a missing Retry into HOLD — there was nothing to recover from — never PASS.
 */
export function recoverySavedVerdict(o: {
    variant: AdverseVariant; preconditionEstablished: boolean; attempt: RecoveryAttempt; savedId: string | null; rows: readonly SessionRowFacts[];
}): Verdict {
    const expected = RECOVERY_CONTROLS[o.variant];
    const a = o.attempt;
    if (a.offered === null || !expected.includes(a.offered)) {
        const offered = a.offered ?? 'no recovery control';
        if (!o.preconditionEstablished) {
            return { status: 'HOLD', detail: `the failure was not established, so its recovery is not judged (the page offered ${offered})` };
        }
        return { status: 'FAIL', detail: `the page offered ${offered}, not ${expected.join(' or ')}, for the recovery` };
    }
    if (a.offered === 'mic-retry') {
        if (a.retry === 'unobserved') return { status: 'HOLD', detail: 'the model status after Retry was not observed, so the recovery is not judged' };
        if (a.retry === 'failed-again') return { status: 'FAIL', detail: 'Retry setup failed again after the cause was removed' };
        if (a.retry !== 'ready') return { status: 'FAIL', detail: 'the model did not reach ready after Retry' };
    }
    if (a.startEnabled === false) return { status: 'FAIL', detail: 'Start never became enabled after Retry brought the model to ready' };
    if (!a.recorded) return { status: 'FAIL', detail: 'no take recorded after the recovery press' };
    const saved = savedTakeReadbackVerdict(o.rows, o.savedId);
    return saved.status === 'PASS'
        ? { status: 'PASS', detail: `after the cause was removed, ${saved.detail}` }
        : saved;
}

const DIGEST = /^[0-9a-f]{64}$/;

/** SHA-256 of the saved transcript, TRIMMED like the harness readback; null when it is not available or empty. Text stays here. */
export function savedTranscriptDigest(row: { transcript_state?: unknown; transcript?: unknown } | null | undefined): string | null {
    if (!row || row.transcript_state !== 'available' || typeof row.transcript !== 'string') return null;
    const trimmed = row.transcript.trim();
    return trimmed === '' ? null : createHash('sha256').update(trimmed).digest('hex');
}

/** What the reopen observed: Analytics listed the take, its detail showed a transcript, and the digests before/after reload. */
export interface ReopenObservation {
    listed: boolean; detailShown: boolean; before: string | null; reloadShown: boolean; after: string | null;
}

/**
 * review-reopen (harness source-adapters.cjs `saveReopen` / browser-actions.cjs `reopen`): from `/analytics`, the take's own
 * `open-session-detail-<id>` opens a `session-detail-transcript` whose trimmed text digests to the saved transcript's
 * trimmed digest, and again after a reload. No saved take or no readable saved transcript → HOLD (nothing to compare).
 */
export function reviewReopenVerdict(o: ReopenObservation & { savedId: string | null; savedDigest: string | null }): Verdict {
    if (o.savedId === null) return { status: 'HOLD', detail: 'no saved recovery take to reopen' };
    if (o.savedDigest === null || !DIGEST.test(o.savedDigest)) {
        return { status: 'HOLD', detail: 'the saved transcript is not available, so the reopened detail cannot be compared' };
    }
    if (!o.listed) return { status: 'FAIL', detail: 'Analytics does not list the saved take' };
    if (!o.detailShown || o.before === null || !DIGEST.test(o.before)) return { status: 'FAIL', detail: 'the opened detail showed no readable transcript' };
    if (o.before !== o.savedDigest) return { status: 'FAIL', detail: 'the reopened transcript differs from the saved one' };
    if (!o.reloadShown || o.after === null || !DIGEST.test(o.after)) return { status: 'FAIL', detail: 'after reload the detail showed no readable transcript' };
    if (o.after !== o.savedDigest) return { status: 'FAIL', detail: 'after reload the transcript differs from the saved one' };
    return { status: 'PASS', detail: 'Analytics reopened the saved take with its saved transcript, before and after a reload (digest equal)' };
}

/**
 * AHT-14 "mid-download": the page had RECEIVED model bytes and the transfer was still running when the browser went offline.
 * `mic-progress` is the product's own byte count (transformers.js reports `loaded / total` while reading each response body in
 * the model worker; the store keeps it as a percent), so a rendered 1–99 % while `loading` is bytes seen, mid-transfer — and it
 * is read in the page, whether or not the worker's fetches reach Playwright's network events. 100 % is a finished transfer.
 */
export type ModelBytesRead = { pct: number | null; status: string | null; runtimeState?: string | null };
export function modelBytesSeen(read: ModelBytesRead | null): boolean {
    return read !== null && read.status === 'loading' && typeof read.pct === 'number' && read.pct >= 1 && read.pct < 100;
}

/**
 * AHT-14 injection gate (Sam, 2026-11-15, after rc-gates run 43740031821). The browser goes offline ONLY while the product's own
 * state machine (`data-runtime-state`, the exact TranscriptionService state) is DOWNLOADING and the page shows received bytes
 * mid-transfer. The model status alone cannot say that: TranscriptionService publishes `ready` for READY and for RECORDING, and
 * `loading` for DOWNLOAD_COMPLETE and ENGINE_INITIALIZING too. In that run the journey went offline after its read had settled,
 * the cold `Download & start recording` press was already recording, the take's session could not be written, and the account
 * kept an admitted save that no timer, lease release or cleanup may settle (#1643), so the run-owned account could not be deleted.
 * Anything but a proven mid-transfer download is no injection: the fault is never put on a page that may be recording.
 */
export const DOWNLOAD_RUNTIME_STATE = 'DOWNLOADING';
export type OfflineInjectionGate = { inject: true } | { inject: false; reason: string };
export function offlineInjectionGate(read: ModelBytesRead | null): OfflineInjectionGate {
    if (read === null) return { inject: false, reason: 'the page state was unreadable' };
    if (read.runtimeState !== DOWNLOAD_RUNTIME_STATE) {
        return { inject: false, reason: `the runtime state was ${read.runtimeState ?? 'unreadable'}, not ${DOWNLOAD_RUNTIME_STATE}` };
    }
    if (!modelBytesSeen(read)) return { inject: false, reason: 'no model bytes were seen mid-transfer' };
    return { inject: true };
}

/**
 * Read once, right after `setOffline(true)` resolved: the fault landed during the download only if the runtime is still
 * DOWNLOADING, or its setup has already failed (INIT_FAILED / FAILED). Any other state (DOWNLOAD_COMPLETE, ENGINE_INITIALIZING,
 * READY, RECORDING, unreadable) means the transfer may have finished before the fault applied, so the journey restores the
 * network at once, before the recording a cold press starts can try to write its take. A FAILED read here cannot be a recording's
 * save failure: that needs DOWNLOADING → … → RECORDING → FAILED between two reads, and the gate saw DOWNLOADING just before.
 */
export const OFFLINE_FAULT_LANDED_STATES = ['DOWNLOADING', 'INIT_FAILED', 'FAILED'] as const;
export function offlineFaultLanded(runtimeState: string | null): boolean {
    return runtimeState !== null && (OFFLINE_FAULT_LANDED_STATES as readonly string[]).includes(runtimeState);
}

/** The failure row when no mid-download fault was exercised (the gate refused, or the fault missed the download): never PASS. */
export function offlineNotExercisedVerdict(reason: string): Verdict {
    return { status: 'HOLD', detail: `the browser was not kept offline mid-download (${reason}), so no download failure was exercised` };
}

/**
 * The recovery row when no fault was exercised. The cold press goes on to download and record ONLINE; the journey stops that take
 * through the product's own Stop and waits for its save, so the account never keeps a recorded take with no saved row. Retry is
 * not judged (there was nothing to retry): HOLD at best. A take that recorded but whose save was not confirmed is FAIL, because
 * the account may then hold an unsettled save; the cleanup row reports whether deletion settled.
 */
export function coldTakeSettledVerdict(o: { recorded: boolean; savedId: string | null }): Verdict {
    if (o.recorded && o.savedId === null) {
        return { status: 'FAIL', detail: 'no fault was exercised; the cold take recorded online but its save was not confirmed, so a save may be unsettled' };
    }
    if (o.recorded) {
        return { status: 'HOLD', detail: 'no fault was exercised, so Retry was not judged; the cold take that recorded online was stopped and saved' };
    }
    return { status: 'HOLD', detail: 'no fault was exercised and the cold press did not record, so there was nothing to recover' };
}

/**
 * download-fault-exercised + download-failure-truthful for AHT-14. HOLD (never PASS) when no model bytes were seen before going
 * offline — that is offline-before-download, not mid-download — or when no failed model request of this attempt was observed
 * while the fault was armed (the download runs in a Web Worker; if Playwright does not surface that worker's fetches, or the
 * transfer finished before offline applied, the fault's reach is unproven). Otherwise the AHT-13 rule decides, unchanged.
 */
export function midDownloadFailureVerdict(o: Parameters<typeof downloadFailureVerdict>[0] & { bytesSeenBeforeOffline: boolean }): Verdict {
    if (o.observed === false || o.statuses.length === 0) return downloadFailureVerdict(o);
    if (!o.bytesSeenBeforeOffline) {
        return { status: 'HOLD', detail: 'no model bytes were seen before going offline, so this was not offline mid-download' };
    }
    if (!o.exercised) {
        return { status: 'HOLD', detail: 'model bytes were seen, but no failed model request of this download was observed after going offline (worker fetches may not reach Playwright\'s network events), so the fault\'s reach is unproven' };
    }
    return downloadFailureVerdict(o);
}
