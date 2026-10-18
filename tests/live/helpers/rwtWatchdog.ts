/**
 * #1593 (PO 2026-10-18) — FAIL EARLY, AND SAY WHY.
 *
 * Live case 12 (run 39167876945) waited blind for 30 minutes. Its own telemetry had the answer in the first 12: a Start
 * with the microphone denied reached RECORDING, the take's save ended `session_completion_failed`, and Start never
 * re-enabled. The tap already decodes every event the page sends, live; nothing read it while the spec waited.
 *
 * This is a TRIPWIRE armed for the whole journey. It reads two content-free streams:
 *   1. the app's own telemetry (closed enums only — `WATCHED_FIELDS`), for a FATAL signal the suite did not expect;
 *   2. the page's DOM state (`data-runtime-state`, `data-model-status`, the primary control's enabled state), for a STALL:
 *      a transitional state that never ends, or a Start that stays disabled with nothing in progress.
 * On the first unexpected signal it records it and closes the journey's browser contexts, so every pending Playwright
 * wait rejects at once; the spec's own catch records `scenario execution` and its `finally` still runs the run-owned
 * cleanup (which uses the service client, not the page). A heartbeat line every 30 s makes a running case legible in
 * the CI log. Everything it prints or records is a closed enum, an integer or a boolean — never content or an id.
 */
import type { BrowserContext, Page } from '@playwright/test';
import type { AnalyticsTap, RwtReceipt, SentEvent } from './rwtJourney';

/** The ONLY properties the watchdog reads from an event: every one a governed closed enum (telemetryAllowlist). */
export const WATCHED_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    recording_state: ['from_state', 'to_state', 'failure_code'],
    recording_intent: ['intent_kind', 'intent_outcome', 'runtime_state_at_intent'],
    session_start_latency_measured: ['outcome'],
    session_save_latency_measured: ['outcome'],
    recording_start_failed: ['runtime_state'],
    private_model_acquisition_failure: [],
    progress_debt: ['phase', 'reason'],
});

export type FatalKind = 'recording_failed' | 'save_failed' | 'start_failed' | 'start_refused' | 'model_failed' | 'recording_while_forbidden';
export type StallKind = 'start_stuck' | 'engine_init_stuck' | 'stop_stuck' | 'start_dead';

export interface WatchProfile {
    /** `recording_state` → FAILED/FAILED_VISIBLE with one of these codes is part of the scenario. */
    readonly allowFailureCodes?: readonly string[];
    /** A refused Start is part of the scenario (lease refusal, the Progress gate on return). */
    readonly allowStartRefused?: boolean;
    /** A failed save is part of the scenario (the save-retry fault). */
    readonly allowSaveFailed?: boolean;
    /** A failed model acquisition or a failed Start is part of the scenario (adverse model download). */
    readonly allowModelFailure?: boolean;
    /**
     * Codex P1 r4309261413: a failed Start — and only that — is part of the scenario (a denied microphone fails the Start
     * through the ordinary start-error path: `recording_start_failed` + a start measured `failed`). Model failures stay fatal.
     */
    readonly allowStartFailure?: boolean;
}

export interface WatchSignal {
    readonly kind: FatalKind | StallKind;
    readonly event: string | null;
    readonly fields: Readonly<Record<string, string | number | boolean>>;
    readonly elapsedMs: number;
}

/**
 * What each of the 15 RWT suites EXPECTS to see. Anything not listed trips. Kept deliberately narrow: a profile widens only
 * for the fault the scenario itself injects or the refusal it is there to prove.
 */
const LEASE_CODES = ['lease_not_held', 'lease_unconfirmed', 'heartbeat_failure'] as const;
export const WATCH_PROFILES: Readonly<Record<string, WatchProfile>> = Object.freeze({
    'open-mic-first-session': {},
    'focus-points-session': {},
    'focus-points-partial': {},
    // The abandoned cold Start is cancelled by leaving; the return may meet the Progress gate.
    'pending-start-navigation': { allowFailureCodes: ['aborted', 'start_did_not_record'], allowStartRefused: true },
    // The injected completion fault fails the first save; Retry Save resolves it.
    'save-retry-recovery-request-lost': { allowSaveFailed: true, allowFailureCodes: ['session_save_failed', 'session_completion_failed', 'finalize_timeout'] },
    'save-retry-recovery-response-lost': { allowSaveFailed: true, allowFailureCodes: ['session_save_failed', 'session_completion_failed', 'finalize_timeout'] },
    'feedback-association-boundaries-older-take': {},
    'feedback-association-boundaries-no-session': {},
    // The left take's lease, the truthful return refusal, the displaced tab.
    'abandon-and-two-tabs-navigate-away': { allowStartRefused: true, allowFailureCodes: [...LEASE_CODES, 'aborted'] },
    'abandon-and-two-tabs-close-tab': { allowStartRefused: true, allowFailureCodes: [...LEASE_CODES, 'aborted'] },
    'abandon-and-two-tabs-take-over': { allowStartRefused: true, allowFailureCodes: [...LEASE_CODES, 'aborted'] },
    // The denied microphone must fail the Start truthfully; RECORDING during that step trips (`setForbidRecording`).
    'adverse-mic-model-mic-denied': {
        allowFailureCodes: ['mic_permission', 'mic_not_allowed', 'mic_not_readable', 'start_failed'],
        allowStartFailure: true,
    },
    'adverse-mic-model-download-fails': { allowModelFailure: true, allowFailureCodes: ['start_model_unavailable', 'engine_error', 'start_failed', 'timeout'] },
    'adverse-mic-model-offline-mid-download': {
        allowModelFailure: true, allowStartRefused: true,
        allowFailureCodes: ['start_model_unavailable', 'engine_error', 'start_failed', 'timeout', ...LEASE_CODES],
    },
    'returning-user-navigation': {},
});

/** The profile for a suite; an unknown suite gets the strictest (empty) profile. */
export const watchProfileFor = (suite: string): WatchProfile => WATCH_PROFILES[suite] ?? {};

/** Stall bounds (ms). The cold model download is the slow legitimate case, so ENGINE_INITIALIZING gets the model budget. */
export const STALL_MS = Object.freeze({
    INITIATING: 90_000,
    ENGINE_INITIALIZING: 600_000,
    STOPPING: 120_000,
    START_DEAD: 90_000,
});

/** The closed watched fields of one decoded event, from the tap's in-memory record. */
export const watchedFieldsOf = (e: Pick<SentEvent, 'watch'>): Record<string, string> => ({ ...(e.watch ?? {}) });

/**
 * Pure: the fatal signal an event carries for this profile, or null. `forbidRecording` is set by the spec around a step
 * whose truthful outcome is NOT a recording (a denied microphone).
 */
export function fatalSignalOf(e: Pick<SentEvent, 'event' | 'watch'>, profile: WatchProfile, forbidRecording = false): FatalKind | null {
    const f = watchedFieldsOf(e);
    switch (e.event) {
        case 'recording_state':
            if (f.to_state === 'FAILED' || f.to_state === 'FAILED_VISIBLE') {
                return (profile.allowFailureCodes ?? []).includes(f.failure_code ?? '') ? null : 'recording_failed';
            }
            return f.to_state === 'RECORDING' && forbidRecording ? 'recording_while_forbidden' : null;
        case 'session_save_latency_measured':
            return f.outcome === 'failed' && !profile.allowSaveFailed ? 'save_failed' : null;
        case 'session_start_latency_measured':
            if (f.outcome === 'refused') return profile.allowStartRefused ? null : 'start_refused';
            return f.outcome === 'failed' && !(profile.allowModelFailure || profile.allowStartFailure) ? 'start_failed' : null;
        case 'recording_start_failed':
            return profile.allowModelFailure || profile.allowStartFailure ? null : 'start_failed';
        case 'recording_intent':
            // Codex P2 r4309261417: a usage-limit, stale-client or lock/lease refusal returns before any start measurement,
            // so the intent's own closed outcome is the only signal that the press was refused.
            return f.intent_outcome?.startsWith('blocked_') && !profile.allowStartRefused ? 'start_refused' : null;
        case 'private_model_acquisition_failure':
            return profile.allowModelFailure ? null : 'model_failed';
        default:
            return null;
    }
}

/** What the DOM shows, closed values only. */
export interface DomState {
    readonly runtimeState: string | null;
    readonly modelStatus: string | null;
    /** The rendered primary control (`mic-start` / `mic-download` / `mic-retry`), if any, and whether it is enabled. */
    readonly control: string | null;
    readonly controlEnabled: boolean | null;
}

const SETTLED = new Set(['IDLE', 'READY', 'DOWNLOAD_REQUIRED', 'TERMINATED', 'FAILED_VISIBLE']);

/**
 * Pure stall rule over the time each condition has held. A transitional runtime state past its bound, or a settled page
 * whose rendered Start stays disabled with no model download in progress, is a stall.
 */
export function stallOf(dom: DomState, heldMs: number): StallKind | null {
    if (dom.runtimeState === 'INITIATING' && heldMs > STALL_MS.INITIATING) return 'start_stuck';
    if (dom.runtimeState === 'ENGINE_INITIALIZING' && heldMs > STALL_MS.ENGINE_INITIALIZING) return 'engine_init_stuck';
    if (dom.runtimeState === 'STOPPING' && heldMs > STALL_MS.STOPPING) return 'stop_stuck';
    if (SETTLED.has(dom.runtimeState ?? '') && dom.control !== null && dom.controlEnabled === false
        && dom.modelStatus !== 'loading' && heldMs > STALL_MS.START_DEAD) return 'start_dead';
    return null;
}

/** A closed key naming the condition a stall is timed against, so a change in any part restarts the clock. */
const conditionKey = (dom: DomState) => `${dom.runtimeState}|${dom.modelStatus}|${dom.control}|${dom.controlEnabled}`;

async function readDom(page: Page): Promise<DomState | null> {
    return page.evaluate(() => {
        const root = document.documentElement;
        const control = ['mic-start', 'mic-download', 'mic-retry']
            .map((id) => document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null)
            .find((el) => el !== null && el.offsetParent !== null) ?? null;
        return {
            runtimeState: root.getAttribute('data-runtime-state'),
            modelStatus: root.getAttribute('data-model-status'),
            control: control?.getAttribute('data-testid') ?? null,
            controlEnabled: control ? !control.disabled && control.getAttribute('aria-disabled') !== 'true' : null,
        };
    }).catch(() => null);
}

export class WatchdogTripped extends Error {
    constructor(readonly signal: WatchSignal) {
        super(`fail-early watchdog: ${signal.kind}${signal.event ? ` (${signal.event})` : ''}`);
        this.name = 'WatchdogTripped';
    }
}

export interface ArmOptions {
    page: Page;
    readonly tap: AnalyticsTap;
    readonly profile: WatchProfile;
    /** Extra contexts the journey drives (another device); all are closed when the tripwire fires. */
    readonly contexts?: () => readonly (BrowserContext | null)[];
    readonly label: string;
    readonly log?: (line: string) => void;
    readonly pollMs?: number;
    readonly heartbeatMs?: number;
}

/** The journey's tripwire. `stop()` disarms it; `signal` is the first unexpected signal, if any. */
export class JourneyWatchdog {
    signal: WatchSignal | null = null;
    private forbidRecording = false;
    private cursor = 0;
    private readonly started = Date.now();
    private lastKey = '';
    private heldSince = Date.now();
    private lastDom: DomState | null = null;
    private lastEvent: { name: string; at: number } | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private beat: ReturnType<typeof setInterval> | null = null;
    private busy = false;

    private readonly o: ArmOptions;
    constructor(options: ArmOptions) { this.o = { ...options }; }

    arm(): this {
        const log = this.o.log ?? ((line: string) => console.log(line));
        this.timer = setInterval(() => { void this.tick(); }, this.o.pollMs ?? 2_000);
        this.beat = setInterval(() => log(this.heartbeat()), this.o.heartbeatMs ?? 30_000);
        // A body that throws before its `finally` must not keep the worker alive on these timers.
        this.timer.unref?.(); this.beat.unref?.();
        return this;
    }

    /** The journey moved to another page (a closed tab reopened): read its DOM from now on. */
    setPage(page: Page): void { this.o.page = page; }

    /** Around a step whose truthful outcome is no recording (a denied microphone): a RECORDING transition then trips. */
    setForbidRecording(on: boolean): void { this.forbidRecording = on; }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        if (this.beat) clearInterval(this.beat);
        this.timer = null; this.beat = null;
    }

    /** One content-free status line: state, model, control, last watched event and its age. */
    heartbeat(): string {
        const d = this.lastDom;
        const age = this.lastEvent ? Math.round((Date.now() - this.lastEvent.at) / 1000) : null;
        return `RWT_HEARTBEAT ${JSON.stringify({
            label: this.o.label, elapsedS: Math.round((Date.now() - this.started) / 1000),
            runtimeState: d?.runtimeState ?? null, modelStatus: d?.modelStatus ?? null, control: d?.control ?? null,
            controlEnabled: d?.controlEnabled ?? null, heldS: Math.round((Date.now() - this.heldSince) / 1000),
            lastEvent: this.lastEvent?.name ?? null, lastEventAgeS: age, tripped: this.signal?.kind ?? null,
        })}`;
    }

    /** Scan new telemetry, then the DOM. Exposed for tests; the armed interval calls it. */
    async tick(now = Date.now()): Promise<WatchSignal | null> {
        if (this.signal || this.busy) return this.signal;
        this.busy = true;
        try {
            const events = this.o.tap.events;
            for (; this.cursor < events.length; this.cursor += 1) {
                const e = events[this.cursor];
                if (!(e.event in WATCHED_FIELDS)) continue;
                this.lastEvent = { name: e.event, at: e.at };
                const kind = fatalSignalOf(e, this.o.profile, this.forbidRecording);
                if (kind) return await this.trip({ kind, event: e.event, fields: watchedFieldsOf(e), elapsedMs: now - this.started });
            }
            const dom = await readDom(this.o.page);
            if (dom) {
                const key = conditionKey(dom);
                if (key !== this.lastKey) { this.lastKey = key; this.heldSince = now; }
                this.lastDom = dom;
                const stall = stallOf(dom, now - this.heldSince);
                if (stall) {
                    return await this.trip({ kind: stall, event: null, elapsedMs: now - this.started, fields: {
                        runtimeState: dom.runtimeState ?? 'unreadable', modelStatus: dom.modelStatus ?? 'unreadable',
                        control: dom.control ?? 'none', controlEnabled: dom.controlEnabled ?? false, heldMs: now - this.heldSince,
                    } });
                }
            }
            return null;
        } finally { this.busy = false; }
    }

    private async trip(signal: WatchSignal): Promise<WatchSignal> {
        this.signal = signal;
        this.stop();
        (this.o.log ?? ((line: string) => console.log(line)))(`RWT_FAIL_EARLY ${JSON.stringify({ label: this.o.label, ...signal })}`);
        // Close every context the journey drives: each pending Playwright wait on them rejects now, not at its timeout.
        const contexts = new Set<BrowserContext>([this.o.page.context(), ...(this.o.contexts?.() ?? []).filter((c): c is BrowserContext => c !== null)]);
        await Promise.all([...contexts].map((c) => c.close().catch(() => undefined)));
        return signal;
    }

    /** The receipt row: PASS when the journey ran without an unexpected signal, FAIL naming the signal otherwise. */
    record(receipt: RwtReceipt): void {
        this.stop();
        const s = this.signal;
        receipt.row('fail-early watchdog', s ? 'FAIL' : 'PASS', s
            ? `the journey was stopped early: ${s.kind}${s.event ? ` (${s.event})` : ''} after ${Math.round(s.elapsedMs / 1000)} s`
            : 'no unexpected failure, refusal or stall signal during the journey',
        s ? { kind: s.kind, event: s.event ?? 'dom', elapsedMs: s.elapsedMs, ...s.fields } : undefined);
    }
}

/** Arm the tripwire for one journey. */
export function armWatchdog(o: ArmOptions): JourneyWatchdog {
    return new JourneyWatchdog(o).arm();
}

/**
 * #1593 (live case 12, run 39167876945): the Playwright test timeout ended the body before its `finally`, so the run-owned
 * account was never deleted and no receipt was written. A body tracks its owner at creation and marks it done once its own
 * cleanup ran; the suite's `afterEach` — which Playwright runs after a timeout — deletes every owner still tracked. Only a
 * body that never completed its cleanup is retried, so an already-deleted account is never looked up again.
 */
export class CleanupBackstop<O extends { uid: string; email: string }> {
    private readonly owners = new Set<O>();
    track(owner: O): O { this.owners.add(owner); return owner; }
    done(owner: O): void { this.owners.delete(owner); }
    async drain(cleanup: (owner: O) => Promise<unknown>): Promise<void> {
        const pending = [...this.owners].filter((o) => o.uid || o.email);
        this.owners.clear();
        for (const owner of pending) await cleanup(owner);
    }
}
