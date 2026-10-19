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
import type { AnalyticsTap, DocumentRef, RwtReceipt, SentEvent } from './rwtJourney';
import { documentTrackerIfAny } from './rwtDocumentIdentity';
import { COACHING_SETTLE_BOUND_MS } from './rwtCoachingEvidence';

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
export type StallKind = 'start_stuck' | 'engine_init_stuck' | 'stop_stuck' | 'start_dead' | 'download_stuck';

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
    /**
     * Codex P2 on 76a0bf6e: a model download whose READABLE percentage has not moved. A slow but live download advances it;
     * a hung request never does. Without a readable percentage the bound stays above the 900 s cold-model wait.
     */
    DOWNLOAD_NO_PROGRESS: 180_000,
    DOWNLOAD_UNREADABLE: 960_000,
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
            if (profile.allowStartRefused) return null;
            if (f.intent_outcome?.startsWith('blocked_')) return 'start_refused';
            // Codex P2 r4311284400: a Start pressed while the previous take is still finalizing is dropped — nothing starts
            // and no start measurement follows — so it is a refused Start. A Start suppressed because another Start is
            // already in flight is not: that in-flight Start is the take, and its own outcome is watched.
            return f.intent_kind === 'start' && f.intent_outcome === 'suppressed_finalizing' ? 'start_refused' : null;
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
    /** The download percentage the record control shows while the model loads (`mic-progress`), if any. */
    readonly progress?: number | null;
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
    if (dom.modelStatus === 'loading') {
        // Sam, #1662 RETURN on 46ebed0f (item 1): the 180 s no-progress rule is for the TRANSFER only. Engine initialization
        // also publishes `loading` (with the bar left at 100 %), and keeps its own 960 s budget.
        if (dom.runtimeState === 'ENGINE_INITIALIZING') return null; // `engine_init_stuck` above owns this phase
        const initializing = typeof dom.progress === 'number' && dom.progress >= 100;
        if (initializing) return heldMs > STALL_MS.ENGINE_INITIALIZING ? 'engine_init_stuck' : null;
        if (heldMs > (typeof dom.progress === 'number' ? STALL_MS.DOWNLOAD_NO_PROGRESS : STALL_MS.DOWNLOAD_UNREADABLE)) return 'download_stuck';
    }
    return null;
}

/** A closed key naming the condition a stall is timed against, so a change in any part restarts the clock. */
const conditionKey = (dom: DomState) => `${dom.runtimeState}|${dom.modelStatus}|${dom.control}|${dom.controlEnabled}|${dom.progress ?? '-'}`;

async function readDom(page: Page): Promise<DomState | null> {
    return page.evaluate(() => {
        const root = document.documentElement;
        const control = ['mic-start', 'mic-download', 'mic-retry']
            .map((id) => document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null)
            .find((el) => el !== null && el.offsetParent !== null) ?? null;
        const pct = Number.parseInt(document.querySelector('[data-testid="mic-progress"]')?.textContent ?? '', 10);
        return {
            runtimeState: root.getAttribute('data-runtime-state'),
            modelStatus: root.getAttribute('data-model-status'),
            control: control?.getAttribute('data-testid') ?? null,
            controlEnabled: control ? !control.disabled && control.getAttribute('aria-disabled') !== 'true' : null,
            progress: Number.isFinite(pct) ? pct : null,
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
    /** Sam, #1662 RETURN on f527a033 (item 4): the prohibition, like the fault phase, is judged at each event's capture time. */
    private readonly forbidIntervals: { from: number; to: number }[] = [];
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
     * Sam, #1662 RETURN (b128 controls 2-3): a suite's expected faults are allowed only for events CAPTURED while the spec
     * had its fault phase open — recorded as time intervals and judged by the event's own capture time, never by the phase
     * at scan time. An expected event scanned late stays excused; an earlier unexpected one scanned inside stays fatal.
     */
    private readonly faultIntervals: { from: number; to: number }[] = [];
    /** Time after which the suite's refusal allowance is withdrawn (a take-over press must not be refused again). */
    private refusalRevokedAt: number | null = null;
    /** Sam, #1662 RETURN (b128 control 1): only events SENT by a page this journey watches are its evidence. */
    private readonly watchedPages = new Set<unknown>();
    /**
     * Sam, #1662 RETURN on f527a033 (item 7): from `from`, the suite's FAILURE allowances apply only to events sent by these
     * pages (the displaced tab); every other page — the device taking over — stays strict.
     */
    private failureScope: { from: number; pages: Set<unknown> } | null = null;
    /**
     * Sam, #1662 RETURN on f527a033 (item 3): a boot IS one document load of one page. Each boot id is bound to the first
     * (watched page, document) that sent it and each document to its first boot; any other pairing is a foreign boot, even
     * on a watched page at this release.
     */
    private readonly bootDocument = new Map<string, string>();
    private readonly documentBoot = new Map<string, string>();
    private readonly pageIds = new WeakMap<object, number>();
    private nextPageId = 0;
    /** Bumped by setPage: a DOM read started for the previous page can never judge the new one (b128 control 5). */
    private pageGeneration = 0;

    private readonly o: ArmOptions;
    /** Codex P2 r4309303716: the journey's starting context stays in the close set after the DOM view moves elsewhere. */
    private readonly initialContext: BrowserContext;
    constructor(options: ArmOptions) {
        // Default: the release this run executes against (the same variables `expectedReleaseSha()` reads in rwtJourney).
        const release = options.releaseSha ?? (process.env.EXPECTED_RELEASE_SHA ?? process.env.EXPECT_RELEASE_SHA ?? '').trim();
        this.o = { ...options, releaseSha: release || undefined };
        this.initialContext = options.page.context();
        this.watchedPages.add(options.page);
    }

    arm(): this {
        const log = this.o.log ?? ((line: string) => console.log(line));
        this.timer = setInterval(() => { void this.tick(); }, this.o.pollMs ?? 2_000);
        this.beat = setInterval(() => log(this.heartbeat()), this.o.heartbeatMs ?? 30_000);
        // A body that throws before its `finally` must not keep the worker alive on these timers.
        this.timer.unref?.(); this.beat.unref?.();
        return this;
    }

    /**
     * The journey moved to another page (a reopened tab, another device): read its DOM from now on, and accept its events.
     * A read still pending for the previous page is invalidated, and the stall clock restarts for the new page.
     */
    setPage(page: Page): void {
        this.o.page = page;
        this.watchedPages.add(page);
        this.pageGeneration += 1;
        this.lastKey = '';
        this.heldSince = Date.now();
        this.lastDom = null;
    }

    /**
     * Narrow the refusal allowance for one phase: after a scenario's EXPECTED refusal, the explicit take-over press must not
     * be refused again — a second refusal then trips instead of waiting out the recording timeout.
     */
    setStartRefusedAllowed(allowed: boolean): void { this.refusalRevokedAt = allowed ? null : Date.now(); }

    /** Open (true) or close (false) the phase in which the suite's declared faults are expected. */
    setFaultPhase(open: boolean): void {
        const now = Date.now();
        const last = this.faultIntervals[this.faultIntervals.length - 1];
        if (open && (!last || last.to !== Infinity)) this.faultIntervals.push({ from: now, to: Infinity });
        if (!open && last && last.to === Infinity) last.to = now;
    }

    /** Around a step whose truthful outcome is no recording (a denied microphone): a RECORDING captured then trips. */
    setForbidRecording(on: boolean): void {
        const now = Date.now();
        const last = this.forbidIntervals[this.forbidIntervals.length - 1];
        if (on && (!last || last.to !== Infinity)) this.forbidIntervals.push({ from: now, to: Infinity });
        if (!on && last && last.to === Infinity) last.to = now;
    }

    /** From now, the suite's failure allowances excuse only events sent by `pages`; every other page is strict. */
    scopeFailureAllowance(pages: readonly unknown[]): void { this.failureScope = { from: Date.now(), pages: new Set(pages) }; }

    stop(): void {
        this.stopped = true;
        this.generation += 1;
        if (this.timer) clearInterval(this.timer);
        if (this.beat) clearInterval(this.beat);
        this.timer = null; this.beat = null;
    }

    /**
     * The profile that applied when an event was CAPTURED: the suite's allowances inside a fault interval, else strict.
     * An event without a capture time never earns an allowance (item 4): it is judged strictly.
     */
    private profileAt(captured: number | undefined, sourcePage: unknown): WatchProfile {
        if (captured === undefined) return {};
        const inFault = this.faultIntervals.some((i) => captured >= i.from && captured <= i.to);
        let profile: WatchProfile = inFault ? this.o.profile : {};
        if (this.refusalRevokedAt !== null && captured >= this.refusalRevokedAt) profile = { ...profile, allowStartRefused: false };
        if (this.failureScope && captured >= this.failureScope.from && !this.failureScope.pages.has(sourcePage)) {
            profile = { ...profile, allowFailureCodes: [], allowSaveFailed: false };
        }
        return profile;
    }

    /** Whether recording was forbidden when the event was captured; without a capture time, whether it is forbidden now. */
    private forbiddenAt(captured: number | undefined): boolean {
        if (captured === undefined) {
            const last = this.forbidIntervals[this.forbidIntervals.length - 1];
            return last !== undefined && last.to === Infinity;
        }
        return this.forbidIntervals.some((i) => captured >= i.from && captured <= i.to);
    }

    /**
     * Sam, #1662 RETURN on 76a0bf6e (item 1): the boot of each COMMITTED (page, document) is established from that
     * document's own events, never from first arrival alone. A boot binds to a document only from an event captured after
     * the document's navigation response (so an earlier document's late flush cannot claim it), and a boot already bound to
     * one document can never bind another. Every event a watched page sends registers here, not only watched ones, so the
     * old boot is known before its unload beacons arrive. Returns whether the event belongs to its document's boot.
     */
    private bootMatches(e: SentEvent): boolean {
        const source = e as SentEvent & { sourcePage?: object; sourceDocument?: number; sourceDocumentAt?: number };
        if (!source.sourcePage || !e.bootId) return false;
        const ref = (e as SentEvent & { sourceDocumentRef?: DocumentRef }).sourceDocumentRef;
        // Sam, #1662 RETURN on 65dd8b8f: proven to come from a document the page had already left — excluded, binds nothing.
        if (ref?.resolved && ref.replaced) return false;
        // Unknown provenance: a known boot's event is that boot's own evidence; an unknown boot binds nothing.
        if (ref?.ambiguous && !ref.resolved) return this.bootDocument.has(e.bootId);
        if (source.sourceDocument === undefined) return false;
        let pageId = this.pageIds.get(source.sourcePage);
        if (pageId === undefined) { pageId = this.nextPageId++; this.pageIds.set(source.sourcePage, pageId); }
        const document = `${pageId}:${source.sourceDocument}`;
        const boundDocument = this.bootDocument.get(e.bootId);
        const boundBoot = this.documentBoot.get(document);
        if (boundDocument !== undefined || boundBoot !== undefined) return boundDocument === document && boundBoot === e.bootId;
        const captured = e.capturedAt;
        if (captured === undefined || captured < (source.sourceDocumentAt ?? Number.POSITIVE_INFINITY)) return false;
        this.bootDocument.set(e.bootId, document);
        this.documentBoot.set(document, e.bootId);
        return true;
    }

    /**
     * True when an event is not this journey's evidence: not sent by a watched page, another release, captured before
     * arming, or not from the boot of the committed document that sent it.
     */
    private foreign(e: SentEvent): boolean {
        const source = e as SentEvent & { sourcePage?: object };
        if (!source.sourcePage || !this.watchedPages.has(source.sourcePage)) return true;
        if (this.o.releaseSha && e.releaseSha && e.releaseSha !== this.o.releaseSha) return true;
        if ((e.capturedAt ?? e.at) < this.started - 1_000) return true;
        return !this.bootMatches(e);
    }

    /**
     * Sam, #1662 RETURN on b0dd763a: indexes of events whose document is still settling (a held commit whose response has
     * not arrived). They are retained and re-judged once resolved — never judged against the predecessor document.
     */
    private readonly deferred: number[] = [];

    /**
     * Still unresolved: the event's navigation has not settled, or was abandoned (ambiguous) and the event's boot is not
     * yet known. An ambiguous event from a boot already bound to a document IS judged — as that boot's own evidence,
     * which can only fail closed (Sam, #1662 RETURN on 06fe109b: ambiguity is never proof of predecessor identity).
     */
    private unresolved(e: SentEvent): boolean {
        const ref = (e as SentEvent & { sourceDocumentRef?: DocumentRef }).sourceDocumentRef;
        if (ref === undefined || ref.resolved) return false;
        return !(ref.ambiguous && e.bootId !== undefined && this.bootDocument.has(e.bootId));
    }

    /** Judge one event whose document identity is settled; returns its fatal signal, if any. */
    private judge(e: SentEvent, now: number): WatchSignal | null {
        if (!(e.event in WATCHED_FIELDS)) {
            // Every event a watched page sends establishes its document's boot (never a watched signal itself).
            if (this.watchedPages.has((e as { sourcePage?: unknown }).sourcePage)) this.bootMatches(e);
            return null;
        }
        if (this.foreign(e)) { this.foreignIgnored += 1; return null; }
        this.watchedSeen += 1;
        this.lastEvent = { name: e.event, at: e.at };
        const sourcePage = (e as { sourcePage?: unknown }).sourcePage;
        const kind = fatalSignalOf(e, this.profileAt(e.capturedAt, sourcePage), this.forbiddenAt(e.capturedAt));
        return kind ? { kind, event: e.event, fields: watchedFieldsOf(e), elapsedMs: now - this.started } : null;
    }

    /** Classify every queued event (synchronous); the first unexpected fatal one is returned. */
    private scanTelemetry(now: number): WatchSignal | null {
        const events = this.o.tap.events;
        // Deferred events whose document has since resolved, in capture order.
        for (let i = 0; i < this.deferred.length;) {
            const e = events[this.deferred[i]];
            if (this.unresolved(e)) { i += 1; continue; }
            this.deferred.splice(i, 1);
            const signal = this.judge(e, now);
            if (signal) return signal;
        }
        for (; this.cursor < events.length; this.cursor += 1) {
            const e = events[this.cursor];
            if (this.unresolved(e)) { this.deferred.push(this.cursor); continue; }
            const signal = this.judge(e, now);
            if (signal) { this.cursor += 1; return signal; }
        }
        return null;
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
        const fatal = this.scanTelemetry(now);
        if (fatal) return this.trip(fatal);
        if (this.domRead) return null; // the previous read is still pending; telemetry was scanned regardless
        const generation = this.generation;
        const pageGeneration = this.pageGeneration;
        let stall: WatchSignal | null = null;
        this.domRead = (async () => {
            const dom = await readDomBounded(this.o.page);
            // Fenced: stopped, or the journey moved to another page, while this read was pending.
            if (this.stopped || generation !== this.generation || pageGeneration !== this.pageGeneration || this.signal) return;
            // Codex P2 r4309443357: only a page that publishes the app's runtime state is an observation of the journey.
            if (!dom || dom.runtimeState === null) { this.domUnreadable += 1; return; }
            this.domOk += 1;
            const key = conditionKey(dom);
            if (key !== this.lastKey) { this.lastKey = key; this.heldSince = now; }
            this.lastDom = dom;
            const kind = stallOf(dom, now - this.heldSince);
            if (kind) {
                stall = { kind, event: null, elapsedMs: now - this.started, fields: {
                    runtimeState: dom.runtimeState ?? 'unreadable', modelStatus: dom.modelStatus ?? 'unreadable',
                    control: dom.control ?? 'none', controlEnabled: dom.controlEnabled ?? false, heldMs: now - this.heldSince,
                    progress: dom.progress ?? -1,
                } };
            }
        })().finally(() => { this.domRead = null; });
        await this.domRead;
        if (stall && !this.stopped && generation === this.generation && pageGeneration === this.pageGeneration && !this.signal) return this.trip(stall);
        return null;
    }

    /** Record the first unexpected signal and disarm; the journey is FAILed by it. */
    private mark(signal: WatchSignal): void {
        this.signal = signal;
        this.stop();
        (this.o.log ?? ((line: string) => console.log(line)))(`RWT_FAIL_EARLY ${JSON.stringify({ label: this.o.label, ...signal })}`);
    }

    private async trip(signal: WatchSignal): Promise<WatchSignal> {
        this.mark(signal);
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
        // Codex P2 r4309443352 / Sam b128 control 4: drain every queued event before fencing — a fatal event queued just
        // before finalization must FAIL the journey, not slip past a PASS.
        // At finalization the signal is recorded without closing contexts: the journey is already ending, and the bounded
        // finalization steps that follow still read its pages.
        if (!this.signal) {
            const late = this.scanTelemetry(Date.now());
            if (late) this.mark(late);
        }
        this.stop();
        if (this.domRead) await Promise.race([this.domRead, new Promise((r) => setTimeout(r, DOM_READ_TIMEOUT_MS))]);
        // Sam, #1662 RETURN on f527a033 (item 4): the terminal window closes AFTER the drain — an event that arrived while
        // the last DOM read was draining still judges this journey before its row is written.
        if (!this.signal) {
            const terminal = this.scanTelemetry(Date.now());
            if (terminal) this.mark(terminal);
        }
        const s = this.signal;
        const unresolvedIdentity = this.deferred.filter((i) => this.unresolved(this.o.tap.events[i])).length;
        // Sam, #1662 RETURN on 65dd8b8f: a watched page whose document provenance was never proven, or was lost, cannot finish
        // clean even when none of its events is queued — what it sent cannot be attributed.
        // A conflicting candidate pairing or a request never joined to the browser's record also blocks a clean finish.
        const provenance = [...this.watchedPages].map((page) => documentTrackerIfAny(page)).filter((p) => p !== undefined);
        const unprovenPages = provenance.filter((p) => !p.proven).length;
        const unattributedRequests = provenance.reduce((n, p) => n + p.unattributed, 0);
        const provenanceConflicts = provenance.reduce((n, p) => n + p.conflicts, 0);
        const observation = {
            watchedEvents: this.watchedSeen, foreignIgnored: this.foreignIgnored, domReads: this.domOk, domUnreadable: this.domUnreadable,
            unresolvedIdentity, unprovenPages, unattributedRequests, provenanceConflicts,
        };
        if (s) {
            receipt.row('fail-early watchdog', 'FAIL',
                `the journey was stopped early: ${s.kind}${s.event ? ` (${s.event})` : ''} after ${Math.round(s.elapsedMs / 1000)} s`,
                { kind: s.kind, event: s.event ?? 'dom', elapsedMs: s.elapsedMs, ...s.fields, ...observation });
        } else if (unresolvedIdentity > 0) {
            // Sam, #1662 RETURN on b0dd763a: evidence whose document never settled is not a clean journey.
            receipt.row('fail-early watchdog', 'HOLD', `${unresolvedIdentity} event(s) arrived while a navigation was still settling and never resolved to a document, so no clean run is claimed`, observation);
        } else if (unprovenPages > 0 || unattributedRequests > 0 || provenanceConflicts > 0) {
            receipt.row('fail-early watchdog', 'HOLD', `document provenance is incomplete (${unprovenPages} unproven or lost page source(s), ${unattributedRequests} unattributed request(s), ${provenanceConflicts} conflicting pairing(s)), so no clean run is claimed`, observation);
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

/** Default bound for one finalization step (diagnostics, readback waits, coaching settle, closing a context). */
export const FINALIZE_STEP_MS = 60_000;
/** Account deletion plus its residue readback: the one step whose failure is a FAIL, not a HOLD. */
export const FINALIZE_CLEANUP_MS = 180_000;
/** The coaching settle carries its own Edge-budget bound; its step allows that plus 15 s. */
export const FINALIZE_SETTLE_MS = COACHING_SETTLE_BOUND_MS + 15_000;

export type StepOutcome = 'ok' | 'timeout' | 'error';

/**
 * Sam, #1662 RETURN (bounded, failure-safe finalization): a finalization step that may stall or throw never stands
 * between the journey and its cleanup and receipt. Each named step is bounded and isolated — on timeout or error it yields
 * `undefined`, its closed outcome is kept, and the finalization continues. `report()` then names every step that did not
 * complete: HOLD (the receipt is incomplete), or FAIL when a `critical` step (run-owned cleanup) did not complete, because
 * residue is then unproven. A clean finalization writes no row. Step names are fixed literals; no value is recorded.
 */
export class FinalizationSteps {
    private readonly outcomes = new Map<string, { outcome: StepOutcome; critical: boolean }>();
    private sealed = false;

    /**
     * `run` receives `alive()`: true until this step timed out or the finalization was sealed. A step that outlives its
     * bound keeps running (a promise cannot be cancelled), so every shared mutation it makes must be guarded by `alive()`
     * (Sam, #1662 RETURN on f527a033 item 1: no late `accountDeleted` flip, no row after the receipt).
     */
    async step<T>(name: string, run: (alive: () => boolean) => Promise<T> | T, ms = FINALIZE_STEP_MS, o: { critical?: boolean } = {}): Promise<T | undefined> {
        const timedOut = Symbol('timeout');
        let expired = false;
        const alive = () => !expired && !this.sealed;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<typeof timedOut>((resolve) => { timer = setTimeout(() => { expired = true; resolve(timedOut); }, ms); });
        let outcome: StepOutcome = 'ok';
        try {
            const value = await Promise.race([Promise.resolve().then(() => run(alive)), timeout]);
            if (value === timedOut) { outcome = 'timeout'; return undefined; }
            return value as T;
        } catch {
            outcome = 'error';
            return undefined;
        } finally {
            if (timer) clearTimeout(timer);
            this.outcomes.set(name, { outcome, critical: o.critical === true });
        }
    }

    /** Record an outcome decided outside a step (the deletion's own settlement). */
    note(name: string, outcome: StepOutcome, o: { critical?: boolean } = {}): void {
        this.outcomes.set(name, { outcome, critical: o.critical === true });
    }

    /** The receipt is about to be written: every step still running is fenced from here on. */
    seal(): void { this.sealed = true; }

    /** Every step that did not complete, with its closed outcome. */
    incomplete(): Record<string, StepOutcome> {
        return Object.fromEntries([...this.outcomes].filter(([, v]) => v.outcome !== 'ok').map(([k, v]) => [k, v.outcome]));
    }

    /** Writes the finalization row (if any step did not complete) and seals: later step mutations are fenced. */
    report(receipt: RwtReceipt): void {
        this.seal();
        const incomplete = this.incomplete();
        const names = Object.keys(incomplete);
        if (names.length === 0) return;
        const critical = names.some((n) => this.outcomes.get(n)?.critical);
        receipt.row('journey finalization', critical ? 'FAIL' : 'HOLD', critical
            ? 'the run-owned deletion did not settle as deleted, so residue is unproven; the receipt was still written'
            : `${names.length} finalization step(s) did not complete within their bound; cleanup and the receipt still ran`, incomplete);
    }
}

/** A guarded view of the receipt for a bounded step: rows are recorded only while the step is alive. */
export function aliveReceipt(receipt: RwtReceipt, alive: () => boolean): RwtReceipt {
    return new Proxy(receipt, {
        get(target, prop, receiver) {
            if (prop === 'row') return (...args: Parameters<RwtReceipt['row']>) => { if (alive()) target.row(...args); };
            return Reflect.get(target, prop, receiver);
        },
    });
}

export type CleanupSettlement = 'not_started' | 'pending' | 'deleted' | 'failed';
/** After the first attempt's bound has passed, how much longer the settlement read waits for that SAME deletion. */
export const CLEANUP_SETTLE_GRACE_MS = 10_000;

/**
 * Sam, #1662 RETURN on f527a033 (item 1) — ONE OWNED DELETION per journey. A timed-out cleanup step keeps its deletion
 * running, so a fallback that starts another overlapped it, and a deletion that completed while its retention readback
 * stalled was deleted again. Every caller (the retention proof, the settlement) goes through `run()`, which starts the
 * deletion at most once and returns that same promise; `settle()` reads the one deletion's own outcome, separately from
 * any readback, and starts it only if nothing ever did.
 */
export class OwnedCleanup<T = unknown> {
    private deletion: Promise<T> | null = null;
    private state: CleanupSettlement = 'not_started';
    constructor(private readonly remove: () => Promise<T>) {}

    get settlement(): CleanupSettlement { return this.state; }

    run(): Promise<T> {
        if (!this.deletion) {
            this.state = 'pending';
            this.deletion = Promise.resolve().then(this.remove).then(
                (value) => { this.state = 'deleted'; return value; },
                (error: unknown) => { this.state = 'failed'; throw error; },
            );
        }
        return this.deletion;
    }

    async settle(ms: number): Promise<CleanupSettlement> {
        const deletion = this.run().catch(() => undefined);
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([deletion, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
        if (timer) clearTimeout(timer);
        return this.state;
    }
}

/**
 * The journey's run-owned cleanup, exactly once: an optional retention proof (which deletes through the same
 * `OwnedCleanup`), then the deletion's OWN settlement — never a second delete. A stalled readback is a HOLD of its proof
 * step; only a deletion that did not settle as deleted is the critical FAIL. Writes the `run-owned cleanup` row unless the
 * proof already did. Returns the settlement.
 */
export async function finalizeOwnedCleanup<T>(steps: FinalizationSteps, receipt: RwtReceipt, cleanup: OwnedCleanup<T>,
    proof?: (alive: () => boolean) => Promise<unknown>): Promise<CleanupSettlement> {
    if (proof) await steps.step('run-owned cleanup proof', proof, FINALIZE_CLEANUP_MS);
    const settlement = await cleanup.settle(cleanup.settlement === 'not_started' ? FINALIZE_CLEANUP_MS : CLEANUP_SETTLE_GRACE_MS);
    steps.note('run-owned cleanup', settlement === 'deleted' ? 'ok' : settlement === 'failed' ? 'error' : 'timeout', { critical: true });
    if (!receipt.rows.some((r) => r.step === 'run-owned cleanup')) {
        if (settlement === 'deleted') receipt.row('run-owned cleanup', 'PASS', 'the run-owned account was deleted and residue checks passed');
        else if (settlement === 'failed') receipt.row('run-owned cleanup', 'FAIL', 'run-owned account deletion or residue readback failed');
        else receipt.row('run-owned cleanup', 'FAIL', 'the run-owned account deletion did not settle within its bound, so residue is unproven');
    }
    return settlement;
}
