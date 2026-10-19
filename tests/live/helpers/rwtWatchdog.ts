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

/**
 * Stall bounds (ms), each ABOVE the longest wait a journey legitimately spends in that state (Sam, #1662 RETURN: never
 * silently shrink a phase wait): engine preparation waits up to 900 s for the cold model, a Retry Save STOPPING up to
 * 180 s. A state that outlives its bound is stuck by any journey's own standard. Shorter holds are reported by the
 * heartbeat (`heldS`) as diagnostics, never as a FAIL.
 */
export const STALL_MS = Object.freeze({
    INITIATING: 120_000,
    ENGINE_INITIALIZING: 960_000,
    STOPPING: 240_000,
    START_DEAD: 180_000,
});

/** A DOM read that has not answered within this bound is counted as unreadable; it never blocks the telemetry scan. */
export const DOM_READ_TIMEOUT_MS = 5_000;

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

/** A DOM read bounded by DOM_READ_TIMEOUT_MS: a hung evaluation answers null instead of holding the watchdog. */
async function readDomBounded(page: Page): Promise<DomState | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), DOM_READ_TIMEOUT_MS); });
    try { return await Promise.race([readDom(page), timeout]); } finally { if (timer) clearTimeout(timer); }
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
    /**
     * Sam, #1662 RETURN (control 2): only this run's evidence may trip the wire. An event naming another release, or
     * captured before the watchdog was armed, is not this journey's — it is ignored and counted.
     */
    readonly releaseSha?: string;
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
    /** Sam, #1662 RETURN (control 4): after stop(), no in-flight callback may trip; record() drains it first. */
    private stopped = false;
    private generation = 0;
    private domRead: Promise<void> | null = null;
    /** Observation accounting: missing observation is reported, never read as a clean journey. */
    private watchedSeen = 0;
    private foreignIgnored = 0;
    private domOk = 0;
    private domUnreadable = 0;
    /**
     * Sam, #1662 RETURN (control 3): a suite's expected faults are allowed only while the spec has its fault phase open.
     * Outside it the strict (empty) profile applies, so a later take's failure is never excused by an earlier injection.
     */
    private faultPhase = false;

    private readonly o: ArmOptions;
    /** Codex P2 r4309303716: the journey's starting context stays in the close set after the DOM view moves elsewhere. */
    private readonly initialContext: BrowserContext;
    /** Codex P2 r4309303711: a phase may withdraw the suite's refusal allowance (null = the profile's own). */
    private refusalAllowed: boolean | null = null;
    constructor(options: ArmOptions) {
        // Default: the release this run executes against (the same variables `expectedReleaseSha()` reads in rwtJourney).
        const release = options.releaseSha ?? (process.env.EXPECTED_RELEASE_SHA ?? process.env.EXPECT_RELEASE_SHA ?? '').trim();
        this.o = { ...options, releaseSha: release || undefined };
        this.initialContext = options.page.context();
    }

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

    /**
     * Narrow the refusal allowance for one phase: after a scenario's EXPECTED refusal, the explicit take-over press must not
     * be refused again — a second refusal then trips instead of waiting out the recording timeout.
     */
    setStartRefusedAllowed(allowed: boolean): void { this.refusalAllowed = allowed; }

    /** Open (true) or close (false) the phase in which the suite's declared faults are expected. */
    setFaultPhase(open: boolean): void { this.faultPhase = open; }

    /** Around a step whose truthful outcome is no recording (a denied microphone): a RECORDING transition then trips. */
    setForbidRecording(on: boolean): void { this.forbidRecording = on; }

    stop(): void {
        this.stopped = true;
        this.generation += 1;
        if (this.timer) clearInterval(this.timer);
        if (this.beat) clearInterval(this.beat);
        this.timer = null; this.beat = null;
    }

    /** The profile in force now: the suite's allowances inside its fault phase, strict outside it. */
    private activeProfile(): WatchProfile {
        const base: WatchProfile = this.faultPhase ? this.o.profile : {};
        return this.refusalAllowed === null ? base : { ...base, allowStartRefused: this.refusalAllowed };
    }

    /** True when an event is not this journey's evidence (another release, or captured before arming). */
    private foreign(e: SentEvent): boolean {
        if (this.o.releaseSha && e.releaseSha && e.releaseSha !== this.o.releaseSha) return true;
        const captured = e.capturedAt ?? e.at;
        return captured < this.started - 1_000;
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

    /**
     * Scan new telemetry, then (on its own bounded track) the DOM. Exposed for tests; the armed interval calls it.
     * The telemetry scan never waits on a DOM read (Sam, #1662 RETURN: a hung evaluation blocked later fatal telemetry),
     * and nothing trips once stop() has run (control 4).
     */
    async tick(now = Date.now()): Promise<WatchSignal | null> {
        if (this.signal || this.stopped) return this.signal;
        const events = this.o.tap.events;
        for (; this.cursor < events.length; this.cursor += 1) {
            const e = events[this.cursor];
            if (!(e.event in WATCHED_FIELDS)) continue;
            if (this.foreign(e)) { this.foreignIgnored += 1; continue; }
            this.watchedSeen += 1;
            this.lastEvent = { name: e.event, at: e.at };
            const kind = fatalSignalOf(e, this.activeProfile(), this.forbidRecording);
            if (kind) return this.trip({ kind, event: e.event, fields: watchedFieldsOf(e), elapsedMs: now - this.started });
        }
        if (this.domRead) return null; // the previous read is still pending; telemetry was scanned regardless
        const generation = this.generation;
        let stall: WatchSignal | null = null;
        this.domRead = (async () => {
            const dom = await readDomBounded(this.o.page);
            if (this.stopped || generation !== this.generation || this.signal) return; // fenced: stopped while awaiting
            if (!dom) { this.domUnreadable += 1; return; }
            this.domOk += 1;
            const key = conditionKey(dom);
            if (key !== this.lastKey) { this.lastKey = key; this.heldSince = now; }
            this.lastDom = dom;
            const kind = stallOf(dom, now - this.heldSince);
            if (kind) {
                stall = { kind, event: null, elapsedMs: now - this.started, fields: {
                    runtimeState: dom.runtimeState ?? 'unreadable', modelStatus: dom.modelStatus ?? 'unreadable',
                    control: dom.control ?? 'none', controlEnabled: dom.controlEnabled ?? false, heldMs: now - this.heldSince,
                } };
            }
        })().finally(() => { this.domRead = null; });
        await this.domRead;
        if (stall && !this.stopped && generation === this.generation && !this.signal) return this.trip(stall);
        return null;
    }

    private async trip(signal: WatchSignal): Promise<WatchSignal> {
        this.signal = signal;
        this.stop();
        (this.o.log ?? ((line: string) => console.log(line)))(`RWT_FAIL_EARLY ${JSON.stringify({ label: this.o.label, ...signal })}`);
        // Close every context the journey drives: each pending Playwright wait on them rejects now, not at its timeout.
        const contexts = new Set<BrowserContext>([
            this.initialContext, this.o.page.context(), ...(this.o.contexts?.() ?? []).filter((c): c is BrowserContext => c !== null),
        ]);
        await Promise.all([...contexts].map((c) => c.close().catch(() => undefined)));
        return signal;
    }

    /**
     * The receipt row, written only after any in-flight check has drained (Sam, #1662 RETURN control 4): FAIL naming the
     * signal; HOLD when the journey was never actually observed (no readable DOM and no watched telemetry — silence is not
     * a clean journey); PASS otherwise. Observation counts are always recorded.
     */
    async record(receipt: RwtReceipt): Promise<void> {
        this.stop();
        if (this.domRead) await Promise.race([this.domRead, new Promise((r) => setTimeout(r, DOM_READ_TIMEOUT_MS))]);
        const s = this.signal;
        const observation = { watchedEvents: this.watchedSeen, foreignIgnored: this.foreignIgnored, domReads: this.domOk, domUnreadable: this.domUnreadable };
        if (s) {
            receipt.row('fail-early watchdog', 'FAIL',
                `the journey was stopped early: ${s.kind}${s.event ? ` (${s.event})` : ''} after ${Math.round(s.elapsedMs / 1000)} s`,
                { kind: s.kind, event: s.event ?? 'dom', elapsedMs: s.elapsedMs, ...s.fields, ...observation });
        } else if (this.domOk === 0 && this.watchedSeen === 0) {
            receipt.row('fail-early watchdog', 'HOLD', 'the journey was never observed (no readable page state and no watched telemetry), so no clean run is claimed', observation);
        } else {
            receipt.row('fail-early watchdog', 'PASS', 'no unexpected failure, refusal or stall signal during the observed journey', observation);
        }
    }
}

/** Arm the tripwire for one journey. */
export function armWatchdog(o: ArmOptions): JourneyWatchdog {
    return new JourneyWatchdog(o).arm();
}

/**
 * #1593 (live case 12, run 39167876945; Sam, #1662 RETURN control 1) — ONE OWNED FINALIZATION PER JOURNEY.
 *
 * The Playwright test timeout ended the body before its `finally`, so the run-owned account was never deleted and no receipt
 * was written. A Set-based backstop then raced the body's own cleanup and could never publish the receipt. Instead, each
 * journey registers its WHOLE finalization (watchdog row, cleanup, receipt) once: the body's `finally` and the suite's
 * `afterEach` (which Playwright runs after a timeout) invoke the same memoized promise, so it runs exactly once — whichever
 * reaches it first — and the other awaits that same run.
 */
export class JourneyFinalizer {
    private readonly registered = new Map<symbol, () => Promise<void>>();
    private readonly runs = new Map<symbol, Promise<void>>();

    /** Register a journey's finalization; the returned function runs it at most once and always returns that one run. */
    once(finalize: () => Promise<void>): () => Promise<void> {
        const key = Symbol('journey');
        this.registered.set(key, finalize);
        return () => this.run(key);
    }

    private run(key: symbol): Promise<void> {
        const existing = this.runs.get(key);
        if (existing) return existing;
        const finalize = this.registered.get(key);
        if (!finalize) return Promise.resolve();
        const run = Promise.resolve().then(finalize);
        this.runs.set(key, run);
        return run;
    }

    /** afterEach: run every registered finalization that has not run, and await every one in flight. */
    async drain(): Promise<void> {
        const keys = [...this.registered.keys()];
        const results = await Promise.allSettled(keys.map((key) => this.run(key)));
        this.registered.clear();
        this.runs.clear();
        const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed) throw failed.reason;
    }
}
