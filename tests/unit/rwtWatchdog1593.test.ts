// @vitest-environment node
/**
 * #1593 (PO 2026-10-18) — the fail-early watchdog. Live case 12 (run 39167876945, journey telemetry 0dd69eaf) waited blind
 * for 30 minutes and timed out before its cleanup: a denied microphone reached RECORDING at once, the take's save ended
 * `session_completion_failed`, and Start never re-enabled. Each of those is a closed signal the tap already decodes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DOM_READ_TIMEOUT_MS, FINALIZE_CLEANUP_MS, FINALIZE_SETTLE_MS, FinalizationSteps, JourneyFinalizer, OwnedCleanup, aliveReceipt, finalizeOwnedCleanup, JourneyWatchdog, STALL_MS, WATCHED_FIELDS, fatalSignalOf, stallOf, watchProfileFor, type DomState, type WatchProfile } from '../live/helpers/rwtWatchdog';
import { COACHING_SETTLE_BOUND_MS } from '../live/helpers/rwtCoachingEvidence';
import { deniedAfterPress } from '../live/helpers/rwtAdverse';
import { AnalyticsTap, trackDocuments } from '../live/helpers/rwtJourney';
import { documentTrackerOf } from '../live/helpers/rwtDocumentIdentity';
import { applyRwtIdentity, rwtPageReady } from '../live/helpers/rwtBrowserIdentity';
import { EventEmitter } from 'node:events';
import { modelWorkBeforeRefusal } from '../live/helpers/rwtAbandonTakeover';

const ev = (event: string, watch: Record<string, string> = {}) => ({ event, watch, at: Date.now() });
/**
 * A decoded event as the tap stamps it: `sourcePage` / `sourceDocument` (non-enumerable, memory-only) are the page and the
 * document load that SENT it; `bootId` is the envelope's boot. Each fake page gets its own default boot on document 0.
 */
const bootOfPage = new WeakMap<object, string>();
const defaultBoot = (page: unknown): string => {
    const key = page as object;
    if (!bootOfPage.has(key)) bootOfPage.set(key, `boot-${Math.random().toString(36).slice(2, 10)}`);
    return bootOfPage.get(key)!;
};
const sentBy = <T extends object>(page: unknown, e: T, o: { boot?: string; document?: number; documentAt?: number; noCaptureTime?: boolean } = {}): T & { bootId: string } => {
    const at = (e as { at?: number; capturedAt?: number });
    const stamped = Object.assign(e, { bootId: o.boot ?? (e as { bootId?: string }).bootId ?? defaultBoot(page) },
        o.noCaptureTime || at.capturedAt !== undefined || at.at === undefined ? {} : { capturedAt: at.at });
    Object.defineProperty(stamped, 'sourcePage', { value: page, enumerable: false });
    Object.defineProperty(stamped, 'sourceDocument', { value: o.document ?? 0, enumerable: false });
    Object.defineProperty(stamped, 'sourceDocumentAt', { value: o.documentAt ?? 0, enumerable: false });
    return stamped;
};
const NONE: WatchProfile = {};

describe('fatalSignalOf — an unexpected failure, refusal or forbidden recording is fatal; the scenario\'s own is not', () => {
    it('a take that fails is fatal unless its code is part of the scenario', () => {
        const failed = ev('recording_state', { from_state: 'STOPPING', to_state: 'FAILED', failure_code: 'session_completion_failed' });
        expect(fatalSignalOf(failed, NONE)).toBe('recording_failed');
        expect(fatalSignalOf(ev('recording_state', { to_state: 'FAILED_VISIBLE', failure_code: 'engine_error' }), NONE)).toBe('recording_failed');
        expect(fatalSignalOf(failed, { allowFailureCodes: ['session_completion_failed'] })).toBeNull();
        expect(fatalSignalOf(ev('recording_state', { to_state: 'FAILED', failure_code: 'other' }), { allowFailureCodes: ['lease_not_held'] })).toBe('recording_failed');
    });

    it('case 12: RECORDING while the step forbids it (a denied microphone) is fatal; RECORDING otherwise is not', () => {
        const rec = ev('recording_state', { from_state: 'ENGINE_INITIALIZING', to_state: 'RECORDING' });
        expect(fatalSignalOf(rec, NONE, true)).toBe('recording_while_forbidden');
        expect(fatalSignalOf(rec, NONE, false)).toBeNull();
    });

    it('a failed save, a refused or failed Start and a failed model acquisition are fatal unless the profile expects them', () => {
        expect(fatalSignalOf(ev('session_save_latency_measured', { outcome: 'failed' }), NONE)).toBe('save_failed');
        expect(fatalSignalOf(ev('session_save_latency_measured', { outcome: 'failed' }), { allowSaveFailed: true })).toBeNull();
        expect(fatalSignalOf(ev('session_save_latency_measured', { outcome: 'saved' }), NONE)).toBeNull();
        expect(fatalSignalOf(ev('session_start_latency_measured', { outcome: 'refused' }), NONE)).toBe('start_refused');
        expect(fatalSignalOf(ev('session_start_latency_measured', { outcome: 'refused' }), { allowStartRefused: true })).toBeNull();
        expect(fatalSignalOf(ev('session_start_latency_measured', { outcome: 'failed' }), NONE)).toBe('start_failed');
        expect(fatalSignalOf(ev('recording_start_failed', { runtime_state: 'INITIATING' }), NONE)).toBe('start_failed');
        expect(fatalSignalOf(ev('private_model_acquisition_failure'), NONE)).toBe('model_failed');
        expect(fatalSignalOf(ev('private_model_acquisition_failure'), { allowModelFailure: true })).toBeNull();
    });

    it('Codex P1 r4309261413: mic-denied expects its own failed Start, but a model failure stays fatal', () => {
        const micDenied = { allowStartFailure: true };
        expect(fatalSignalOf(ev('recording_start_failed', { runtime_state: 'INITIATING' }), micDenied)).toBeNull();
        expect(fatalSignalOf(ev('session_start_latency_measured', { outcome: 'failed' }), micDenied)).toBeNull();
        expect(fatalSignalOf(ev('private_model_acquisition_failure'), micDenied)).toBe('model_failed');
        expect(fatalSignalOf(ev('session_start_latency_measured', { outcome: 'refused' }), micDenied)).toBe('start_refused');
    });

    it('Codex P2 r4309261417: a blocked intent (usage limit, stale client, lock/lease) is a refused Start', () => {
        for (const outcome of ['blocked_usage_limit', 'blocked_stale_client', 'blocked_lock_held']) {
            expect(fatalSignalOf(ev('recording_intent', { intent_kind: 'start', intent_outcome: outcome }), NONE)).toBe('start_refused');
            expect(fatalSignalOf(ev('recording_intent', { intent_kind: 'start', intent_outcome: outcome }), { allowStartRefused: true })).toBeNull();
        }
        expect(fatalSignalOf(ev('recording_intent', { intent_kind: 'start', intent_outcome: 'accepted' }), NONE)).toBeNull();
        expect(fatalSignalOf(ev('recording_intent', { intent_kind: 'start', intent_outcome: 'suppressed_in_flight' }), NONE)).toBeNull();
    });

    it('Codex P2 r4311284400: a Start dropped because the previous take is still finalizing is a refused Start', () => {
        const dropped = ev('recording_intent', { intent_kind: 'start', intent_outcome: 'suppressed_finalizing' });
        expect(fatalSignalOf(dropped, NONE)).toBe('start_refused');
        expect(fatalSignalOf(dropped, { allowStartRefused: true }), 'a scenario that expects refusals').toBeNull();
        // The in-flight Start is the take (its own outcome is watched); a suppressed Stop is never a refused Start.
        expect(fatalSignalOf(ev('recording_intent', { intent_kind: 'start', intent_outcome: 'suppressed_in_flight' }), NONE)).toBeNull();
        expect(fatalSignalOf(ev('recording_intent', { intent_kind: 'stop', intent_outcome: 'suppressed_finalizing' }), NONE)).toBeNull();
    });

    it('unwatched events never trip', () => {
        expect(fatalSignalOf(ev('journey_step', { step: 'cta_click' }), NONE)).toBeNull();
        expect(fatalSignalOf(ev('ai_coaching_diagnostic', { outcome: 'failed' }), NONE)).toBeNull();
    });

    it('every watched field is a governed closed enum, never content or an id', () => {
        const keys = Object.values(WATCHED_FIELDS).flat();
        expect(keys.every((k) => /^(from_state|to_state|failure_code|intent_kind|intent_outcome|runtime_state_at_intent|outcome|runtime_state|phase|reason)$/.test(k))).toBe(true);
    });
});

describe('stallOf — a transitional state that never ends, or a settled page whose Start stays disabled', () => {
    const dom = (o: Partial<DomState>): DomState => ({ runtimeState: 'READY', modelStatus: 'ready', control: 'mic-start', controlEnabled: true, ...o });

    it('INITIATING, ENGINE_INITIALIZING and STOPPING each have a bound; the cold download gets the model budget', () => {
        expect(stallOf(dom({ runtimeState: 'INITIATING' }), STALL_MS.INITIATING + 1)).toBe('start_stuck');
        expect(stallOf(dom({ runtimeState: 'INITIATING' }), STALL_MS.INITIATING)).toBeNull();
        expect(stallOf(dom({ runtimeState: 'ENGINE_INITIALIZING' }), 300_000)).toBeNull();
        expect(stallOf(dom({ runtimeState: 'ENGINE_INITIALIZING' }), STALL_MS.ENGINE_INITIALIZING + 1)).toBe('engine_init_stuck');
        // Case 12: STOPPING held 93 s before the failure; the bound is above it so a slow-but-finishing stop is not cut off.
        expect(stallOf(dom({ runtimeState: 'STOPPING' }), 93_000)).toBeNull();
        expect(stallOf(dom({ runtimeState: 'STOPPING' }), STALL_MS.STOPPING + 1)).toBe('stop_stuck');
    });

    it('case 4 / case 12: a settled page with its Start rendered but disabled past the bound is a dead Start', () => {
        expect(stallOf(dom({ runtimeState: 'TERMINATED', modelStatus: 'idle', controlEnabled: false }), STALL_MS.START_DEAD + 1)).toBe('start_dead');
        expect(stallOf(dom({ runtimeState: 'IDLE', modelStatus: 'idle', controlEnabled: false }), STALL_MS.START_DEAD)).toBeNull();
    });

    it('not a dead Start: a download in progress, no control on the page, an enabled control, or a recording', () => {
        // A download in progress is never a dead Start (its own bound is `download_stuck`, tested below).
        expect(stallOf(dom({ runtimeState: 'IDLE', modelStatus: 'loading', controlEnabled: false }), 10 * STALL_MS.START_DEAD)).not.toBe('start_dead');
        expect(stallOf(dom({ runtimeState: 'IDLE', modelStatus: 'loading', controlEnabled: false, progress: 5 }), 120_000)).toBeNull();
        expect(stallOf(dom({ runtimeState: 'IDLE', control: null, controlEnabled: null }), 10 * STALL_MS.START_DEAD)).toBeNull();
        expect(stallOf(dom({ runtimeState: 'TERMINATED' }), 10 * STALL_MS.START_DEAD)).toBeNull();
        expect(stallOf(dom({ runtimeState: 'RECORDING', control: null, controlEnabled: null }), 60 * 60_000)).toBeNull();
    });
});

describe('JourneyWatchdog — trips once, closes the journey\'s contexts, and records a content-free row', () => {
    const harness = (domState: DomState | null) => {
        const closed: string[] = [];
        const logs: string[] = [];
        const ctx = (name: string) => ({ close: async () => { closed.push(name); } });
        const mainContext = ctx('main'); // one context object, as a real page returns
        const page = { context: () => mainContext, evaluate: async () => domState };
        const tap = { events: [] as { event: string; at: number; watch?: Record<string, string> }[] };
        const rows: { step: string; verdict: string; detail: string; evidence?: unknown }[] = [];
        const receipt = { row: (step: string, verdict: string, detail: string, evidence?: unknown) => { rows.push({ step, verdict, detail, evidence }); } };
        return { closed, logs, tap, rows, receipt, page, ctx };
    };

    it('a fatal telemetry signal trips at the next tick, closes every context and FAILs the row naming it', async () => {
        const h = harness({ runtimeState: 'RECORDING', modelStatus: 'ready', control: null, controlEnabled: null });
        const w = new JourneyWatchdog({ page: h.page as never, tap: h.tap as never, profile: {}, label: 'case', log: (l) => h.logs.push(l),
            contexts: () => [h.ctx('deviceB') as never, null] });
        h.tap.events.push(sentBy(h.page, { event: 'recording_state', at: Date.now(), watch: { from_state: 'STOPPING', to_state: 'FAILED', failure_code: 'session_completion_failed' } }));
        const s = await w.tick();
        expect(s).toMatchObject({ kind: 'recording_failed', event: 'recording_state', fields: { failure_code: 'session_completion_failed' } });
        expect(h.closed.sort()).toEqual(['deviceB', 'main']);
        expect(h.logs.some((l) => l.startsWith('RWT_FAIL_EARLY '))).toBe(true);
        await w.record(h.receipt as never);
        expect(h.rows).toEqual([expect.objectContaining({ step: 'fail-early watchdog', verdict: 'FAIL' })]);
        // Tripped once: a later tick does not re-trip or close again.
        await w.tick();
        expect(h.closed).toHaveLength(2);
    });

    it('Codex P2 r4309303716: after the DOM view moves to another page, a trip still closes the starting context', async () => {
        const h = harness({ runtimeState: 'RECORDING', modelStatus: 'ready', control: null, controlEnabled: null });
        const w = new JourneyWatchdog({ page: h.page as never, tap: h.tap as never, profile: {}, label: 'case', log: () => undefined });
        const deviceB = { context: () => h.ctx('deviceB'), evaluate: async () => null };
        w.setPage(deviceB as never);
        h.tap.events.push(sentBy(deviceB, { event: 'session_save_latency_measured', at: Date.now(), watch: { outcome: 'failed' } }));
        await w.tick();
        expect(h.closed.sort()).toEqual(['deviceB', 'main']);
    });

    it('Codex P2 r4309303711: a phase can withdraw the suite\'s refusal allowance, so a second refusal trips', async () => {
        const h = harness(null);
        const w = new JourneyWatchdog({ page: h.page as never, tap: h.tap as never, profile: { allowStartRefused: true }, label: 'case', log: () => undefined });
        w.setFaultPhase(true);
        h.tap.events.push(sentBy(h.page, { event: 'session_start_latency_measured', at: Date.now(), watch: { outcome: 'refused' } }));
        expect(await w.tick(), 'the expected first refusal').toBeNull();
        w.setStartRefusedAllowed(false);
        h.tap.events.push(sentBy(h.page, { event: 'recording_intent', at: Date.now() + 1, watch: { intent_kind: 'start', intent_outcome: 'blocked_lock_held' } }));
        expect(await w.tick()).toMatchObject({ kind: 'start_refused', event: 'recording_intent' });
    });

    it('a dead Start trips only after it has held past the bound, timed from when the condition began', async () => {
        const dead: DomState = { runtimeState: 'TERMINATED', modelStatus: 'idle', control: 'mic-start', controlEnabled: false };
        const h = harness(dead);
        const w = new JourneyWatchdog({ page: h.page as never, tap: h.tap as never, profile: {}, label: 'case', log: () => undefined });
        const t0 = Date.now();
        expect(await w.tick(t0)).toBeNull();
        expect(await w.tick(t0 + STALL_MS.START_DEAD - 1)).toBeNull();
        expect(await w.tick(t0 + STALL_MS.START_DEAD + 1)).toMatchObject({ kind: 'start_dead', event: null, fields: { runtimeState: 'TERMINATED', control: 'mic-start', controlEnabled: false } });
    });

    it('a clean journey records PASS, and the heartbeat is one content-free line', async () => {
        const h = harness({ runtimeState: 'READY', modelStatus: 'ready', control: 'mic-start', controlEnabled: true });
        const w = new JourneyWatchdog({ page: h.page as never, tap: h.tap as never, profile: {}, label: 'case', log: () => undefined });
        h.tap.events.push(sentBy(h.page, { event: 'session_save_latency_measured', at: Date.now(), watch: { outcome: 'saved' } }));
        expect(await w.tick()).toBeNull();
        const beat = w.heartbeat();
        expect(beat.startsWith('RWT_HEARTBEAT ')).toBe(true);
        expect(JSON.parse(beat.slice('RWT_HEARTBEAT '.length))).toMatchObject({ runtimeState: 'READY', control: 'mic-start', lastEvent: 'session_save_latency_measured', tripped: null });
        await w.record(h.receipt as never);
        expect(h.rows).toEqual([expect.objectContaining({ step: 'fail-early watchdog', verdict: 'PASS' })]);
        expect(h.closed).toEqual([]);
    });
});

describe('every RWT journey is armed, and every run-owned cleanup survives a timeout', () => {
    const read = (f: string) => readFileSync(f, 'utf8');
    const SUITES = [
        'open-mic-first-session', 'focus-points-session', 'focus-points-partial', 'pending-start-navigation',
        'save-retry-recovery-request-lost', 'save-retry-recovery-response-lost', 'feedback-association-boundaries-older-take',
        'feedback-association-boundaries-no-session', 'abandon-and-two-tabs-navigate-away', 'abandon-and-two-tabs-close-tab',
        'abandon-and-two-tabs-take-over', 'adverse-mic-model-mic-denied', 'adverse-mic-model-download-fails',
        'adverse-mic-model-offline-mid-download', 'returning-user-navigation',
    ];

    it('each of the 15 campaign suites has a declared profile, and nothing else does', async () => {
        const { WATCH_PROFILES } = await import('../live/helpers/rwtWatchdog');
        expect(Object.keys(WATCH_PROFILES).sort()).toEqual([...SUITES].sort());
    });

    it('every RWT journey file arms the watchdog and records its row in the finally', () => {
        const files = [
            'tests/live/rwt-open-mic-first-session.live.spec.ts', 'tests/live/helpers/rwtFocusPointsJourney.ts',
            'tests/live/rwt-pending-start-navigation.live.spec.ts', 'tests/live/rwt-save-retry-recovery.live.spec.ts',
            'tests/live/rwt-feedback-association-boundaries.live.spec.ts', 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts',
            'tests/live/rwt-adverse-mic-model.live.spec.ts', 'tests/live/rwt-products-navigation.live.spec.ts',
        ];
        for (const f of files) {
            const src = read(f);
            const armed = (src.match(/armWatchdog\(/g) ?? []).length;
            expect(armed, `${f} arms the watchdog`).toBeGreaterThan(0);
            expect((src.match(/watch\.record\(receipt\)/g) ?? []).length, `${f} records every armed watchdog`).toBe(armed);
        }
    });

    it('Codex P1 r4309261415: the two-device journey points the watchdog at the page each phase waits on', () => {
        const src = read('tests/live/rwt-abandon-and-two-tabs.live.spec.ts');
        const order = ['watch.setPage(sameBrowserTab);', 'watch.setPage(tabA);', 'watch.setPage(deviceB);'].map((m) => src.indexOf(m));
        expect(order.every((i) => i > 0), 'each retarget is present').toBe(true);
        expect(order, 'in phase order').toEqual([...order].sort((a, b) => a - b));
    });

    it('Sam #1662 RETURN item 1: every armed journey finalizes through ONE JourneyFinalizer; no afterEach deletes directly', () => {
        const afterEachBody = (src: string): string => {
            const at = src.indexOf('test.afterEach(');
            if (at === -1) return '';
            const indent = src.slice(src.lastIndexOf('\n', at) + 1, at);
            return src.slice(at, src.indexOf(`\n${indent}});`, at));
        };
        for (const f of readdirSync('tests/live').filter((n) => /^rwt-.*\.live\.spec\.ts$/.test(n))) {
            const src = read(`tests/live/${f}`);
            const journey = src.includes('focusPointsJourney(') ? read('tests/live/helpers/rwtFocusPointsJourney.ts') : src;
            if (!/armWatchdog\(/.test(journey)) continue;
            expect(journey, `${f}: the finalization is registered once`).toMatch(/finalizer\.once\(async \(\) => \{/);
            expect(journey, `${f}: the body's finally runs that same finalization`).toMatch(/\} finally \{\s*await finish\(\);/);
            expect(afterEachBody(src), `${f}: the afterEach drains it`).toContain('await finalizer.drain();');
            expect(afterEachBody(src), `${f}: no direct afterEach account deletion`).not.toContain('cleanupRunOwnedAccount(');
        }
    });

    it('Sam #1662 RETURN item 2: every finalization bounds its steps and reports before writing the receipt', () => {
        const files = [
            'tests/live/rwt-open-mic-first-session.live.spec.ts', 'tests/live/helpers/rwtFocusPointsJourney.ts',
            'tests/live/rwt-pending-start-navigation.live.spec.ts', 'tests/live/rwt-save-retry-recovery.live.spec.ts',
            'tests/live/rwt-feedback-association-boundaries.live.spec.ts', 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts',
            'tests/live/rwt-adverse-mic-model.live.spec.ts', 'tests/live/rwt-products-navigation.live.spec.ts',
        ];
        for (const f of files) {
            const src = read(f);
            // Every finalization closure: from its registration to its report (or the shared helper that reports).
            const closures = src.split('finalizer.once(').slice(1).map((c) => {
                const ends = ['steps.report(receipt);', 'await finishReceipt(', 'await finishJourney('].map((m) => c.indexOf(m)).filter((i) => i > -1);
                return c.slice(0, ends.length > 0 ? Math.min(...ends) : undefined);
            });
            expect((src.match(/steps\.step\('watchdog', \(\) => watch\.record\(receipt\)\)/g) ?? []).length, `${f}: the watchdog row is a bounded step`)
                .toBe((src.match(/watch\.record\(receipt\)/g) ?? []).length);
            for (const c of closures) expect(c, `${f}: the coaching settle is bounded`).not.toMatch(/^\s*await generations\.settle\(\);/m);
            expect(src.indexOf('steps.report(receipt);'), `${f}: the report precedes the receipt`).toBeGreaterThan(-1);
            expect(src.lastIndexOf('steps.report(receipt);')).toBeLessThan(src.lastIndexOf('receipt.write('));
            for (const cleanup of src.match(/steps\.step\('run-owned cleanup[^']*',[\s\S]*?\}, FINALIZE_CLEANUP_MS(, \{ critical: true \})?\)/g) ?? []) {
                expect(cleanup, `${f}: cleanup is the critical step`).toContain('{ critical: true }');
            }
        }
    });
});

/**
 * Sam's #1662 RETURN controls (executed against 4cd98533): each reproduced a defect in the integration. Every one must hold.
 */
describe('#1662 RETURN — single-flight finalization, bound evidence, phase scope, fencing, observation', () => {
    const fakes = (domState: () => Promise<DomState | null>) => {
        const closed: string[] = [];
        const ctx = { close: async () => { closed.push('main'); } };
        const page = { context: () => ctx, evaluate: domState };
        const tap = { events: [] as { event: string; at: number; capturedAt?: number; releaseSha?: string; watch?: Record<string, string> }[] };
        const rows: { step: string; verdict: string }[] = [];
        const receipt = { row: (step: string, verdict: string) => { rows.push({ step, verdict }); } };
        return { closed, page, tap, rows, receipt };
    };
    const quiet = { log: () => undefined, label: 'case' };

    it('control 1: the body\'s finish and the afterEach drain run ONE finalization, and drain runs one the body never reached', async () => {
        const f = new JourneyFinalizer();
        let runs = 0;
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const finish = f.once(async () => { runs += 1; await gate; });
        const body = finish();
        const drain = f.drain();
        release();
        await Promise.all([body, drain]);
        expect(runs, 'concurrent body + backstop run it once').toBe(1);

        const g = new JourneyFinalizer();
        let published = false;
        g.once(async () => { published = true; }); // a body that timed out before its finally
        await g.drain();
        expect(published, 'the timeout path still finalizes (cleanup + receipt)').toBe(true);
    });

    it('control 2: an event from another release, or captured before arming, never trips the wire', async () => {
        const h = fakes(async () => null);
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {}, releaseSha: 'a'.repeat(40) });
        h.tap.events.push(sentBy(h.page, { event: 'session_save_latency_measured', at: Date.now(), releaseSha: 'b'.repeat(40), watch: { outcome: 'failed' } }));
        h.tap.events.push(sentBy(h.page, { event: 'session_save_latency_measured', at: 0, capturedAt: 0, watch: { outcome: 'failed' } }));
        expect(await w.tick()).toBeNull();
        expect(h.closed).toEqual([]);
        h.tap.events.push(sentBy(h.page, { event: 'session_save_latency_measured', at: Date.now(), releaseSha: 'a'.repeat(40), watch: { outcome: 'failed' } }));
        expect(await w.tick(), 'this run\'s own failure still trips').toMatchObject({ kind: 'save_failed' });
    });

    it('control 3: an injected fault is excused only inside its phase — a later take\'s failure trips', async () => {
        const h = fakes(async () => null);
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: { allowSaveFailed: true } });
        w.setFaultPhase(true);
        h.tap.events.push(sentBy(h.page, { event: 'session_save_latency_measured', at: Date.now(), watch: { outcome: 'failed' } }));
        expect(await w.tick(), 'the injected failure').toBeNull();
        w.setFaultPhase(false);
        h.tap.events.push(sentBy(h.page, { event: 'session_save_latency_measured', at: Date.now() + 1, watch: { outcome: 'failed' } }));
        expect(await w.tick(), 'the next take\'s failure').toMatchObject({ kind: 'save_failed' });
    });

    it('control 4: a DOM read in flight when the journey stops never trips afterwards; record() drains it first', async () => {
        let answer!: (d: DomState) => void;
        const h = fakes(() => new Promise<DomState>((r) => { answer = r; }));
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        const t0 = Date.now() - 10 * STALL_MS.START_DEAD; // a condition that would be a dead Start
        const pending = w.tick(t0);
        const recorded = w.record(h.receipt as never);
        answer({ runtimeState: 'TERMINATED', modelStatus: 'idle', control: 'mic-start', controlEnabled: false });
        await Promise.all([pending, recorded]);
        expect(h.closed, 'no context closed after stop').toEqual([]);
        expect(h.rows.map((r) => r.verdict)).toEqual(['HOLD']); // nothing was observed before the stop
    });

    it('a hung DOM evaluation never blocks the telemetry scan', async () => {
        const h = fakes(() => new Promise<DomState>(() => { /* never answers */ }));
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        void w.tick(); // the DOM read hangs
        h.tap.events.push(sentBy(h.page, { event: 'recording_state', at: Date.now(), watch: { to_state: 'FAILED', failure_code: 'engine_error' } }));
        expect(await w.tick(), 'the fatal event is still seen').toMatchObject({ kind: 'recording_failed' });
        expect(DOM_READ_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
    });

    it('missing observation is HOLD, never PASS; an observed clean journey is PASS', async () => {
        const silent = fakes(async () => null);
        const w1 = new JourneyWatchdog({ ...quiet, page: silent.page as never, tap: silent.tap as never, profile: {} });
        await w1.tick();
        await w1.record(silent.receipt as never);
        expect(silent.rows.map((r) => r.verdict)).toEqual(['HOLD']);

        const seen = fakes(async () => ({ runtimeState: 'READY', modelStatus: 'ready', control: 'mic-start', controlEnabled: true }));
        const w2 = new JourneyWatchdog({ ...quiet, page: seen.page as never, tap: seen.tap as never, profile: {} });
        await w2.tick();
        await w2.record(seen.receipt as never);
        expect(seen.rows.map((r) => r.verdict)).toEqual(['PASS']);
    });

    it('stall bounds sit above the phase waits they guard (Sam: never shrink a wait)', () => {
        expect(STALL_MS.ENGINE_INITIALIZING).toBeGreaterThan(900_000); // cold model preparation waits up to 900 s
        expect(STALL_MS.STOPPING).toBeGreaterThan(180_000); // Retry Save's STOPPING waits up to 180 s
    });
});

/**
 * Sam's #1662 RETURN on b128cdf9 (consolidated correction list). Each control below reproduces a defect at b128cdf9 and
 * must hold on the successor; the existing negative controls above stay green.
 */
describe('#1662 RETURN on b128cdf9 — page binding, event-time phases, invalidation, drain, observation, finalization', () => {
    const fakes = (domState: () => Promise<DomState | null>) => {
        const closed: string[] = [];
        const ctx = (name: string) => ({ close: async () => { closed.push(name); } });
        const main = ctx('main');
        const page = { context: () => main, evaluate: domState };
        const tap = { events: [] as { event: string; at: number; capturedAt?: number; releaseSha?: string; watch?: Record<string, string> }[] };
        const rows: { step: string; verdict: string; evidence?: unknown }[] = [];
        const receipt = { row: (step: string, verdict: string, _detail: string, evidence?: unknown) => { rows.push({ step, verdict, evidence }); } };
        return { closed, ctx, page, tap, rows, receipt };
    };
    const quiet = { log: () => undefined, label: 'case' };
    const saveFailed = (at = Date.now()) => ({ event: 'session_save_latency_measured', at, watch: { outcome: 'failed' } });

    it('item 3: an event sent by a page the journey does not watch never trips, even on the same release', async () => {
        const h = fakes(async () => null);
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {}, releaseSha: 'a'.repeat(40) });
        const otherBoot = { context: () => h.ctx('other'), evaluate: async () => null }; // another tab or boot, never watched
        h.tap.events.push(sentBy(otherBoot, { ...saveFailed(), releaseSha: 'a'.repeat(40) }));
        h.tap.events.push({ ...saveFailed(), releaseSha: 'a'.repeat(40) }); // no source page at all
        expect(await w.tick(), 'foreign evidence').toBeNull();
        expect(h.closed).toEqual([]);
        h.tap.events.push(sentBy(h.page, { ...saveFailed(), releaseSha: 'a'.repeat(40) }));
        expect(await w.tick(), 'the watched page\'s own failure').toMatchObject({ kind: 'save_failed' });
    });

    it('item 3: after setPage, both the new page and the starting page are watched', async () => {
        const h = fakes(async () => null);
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        const deviceB = { context: () => h.ctx('deviceB'), evaluate: async () => null };
        w.setPage(deviceB as never);
        h.tap.events.push(sentBy(h.page, saveFailed()));
        expect(await w.tick(), 'the starting page is still this journey').toMatchObject({ kind: 'save_failed' });
    });

    it('item 4: a fault captured inside its phase but scanned after it closed stays excused', async () => {
        const h = fakes(async () => null);
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: { allowSaveFailed: true } });
        w.setFaultPhase(true);
        const insidePhase = Date.now();
        await new Promise((r) => setTimeout(r, 2));
        w.setFaultPhase(false);
        h.tap.events.push(sentBy(h.page, saveFailed(insidePhase))); // queued during the phase, scanned after
        expect(await w.tick()).toBeNull();
    });

    it('item 4: a fault captured before its phase opened stays fatal when scanned inside it', async () => {
        const h = fakes(async () => null);
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: { allowSaveFailed: true } });
        const beforePhase = Date.now();
        await new Promise((r) => setTimeout(r, 2));
        w.setFaultPhase(true);
        h.tap.events.push(sentBy(h.page, saveFailed(beforePhase)));
        expect(await w.tick()).toMatchObject({ kind: 'save_failed' });
    });

    it('item 4: a refusal captured before the allowance was withdrawn stays excused; one after it trips', async () => {
        const h = fakes(async () => null);
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: { allowStartRefused: true } });
        w.setFaultPhase(true);
        const expected = Date.now();
        await new Promise((r) => setTimeout(r, 2));
        w.setStartRefusedAllowed(false);
        h.tap.events.push(sentBy(h.page, { event: 'session_start_latency_measured', at: expected, watch: { outcome: 'refused' } }));
        expect(await w.tick(), 'the expected refusal, scanned late').toBeNull();
        h.tap.events.push(sentBy(h.page, { event: 'session_start_latency_measured', at: Date.now() + 1, watch: { outcome: 'refused' } }));
        expect(await w.tick(), 'a refusal of the take-over press').toMatchObject({ kind: 'start_refused' });
    });

    it('item 5: a DOM read pending for the old page cannot trip or close anything after setPage', async () => {
        const dead: DomState = { runtimeState: 'TERMINATED', modelStatus: 'idle', control: 'mic-start', controlEnabled: false };
        let answer: ((d: DomState) => void) | null = null;
        const h = fakes(() => (answer === null ? Promise.resolve(dead) : new Promise<DomState>((r) => { answer = r; })));
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        const t0 = Date.now();
        expect(await w.tick(t0), 'the old page\'s dead Start begins').toBeNull();
        answer = () => undefined; // the next read for the old page stays pending
        const pending = w.tick(t0 + STALL_MS.START_DEAD + 1); // it would be a dead Start past the bound
        w.setPage({ context: () => h.ctx('deviceB'), evaluate: async () => null } as never);
        (answer as (d: DomState) => void)(dead);
        expect(await pending).toBeNull();
        expect(w.signal).toBeNull();
        expect(h.closed).toEqual([]);
    });

    it('item 6: record() drains telemetry queued after the last tick — a late fatal event FAILs, never PASS', async () => {
        const h = fakes(async () => ({ runtimeState: 'READY', modelStatus: 'ready', control: 'mic-start', controlEnabled: true }));
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        await w.tick();
        h.tap.events.push(sentBy(h.page, { event: 'recording_state', at: Date.now(), watch: { to_state: 'FAILED', failure_code: 'engine_error' } }));
        await w.record(h.receipt as never);
        expect(h.rows.map((r) => r.verdict)).toEqual(['FAIL']);
    });

    it('item 7: a page without the app\'s runtime state is not an observation — the journey reads HOLD, never PASS', async () => {
        const h = fakes(async () => ({ runtimeState: null, modelStatus: null, control: null, controlEnabled: null }));
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        await w.tick();
        await w.tick();
        await w.record(h.receipt as never);
        expect(h.rows).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ domReads: 0, domUnreadable: 2 }) })]);
    });

    it('item 9 (+ item 5 on f527a033): only THIS press\'s own acquisition, refused with NotAllowedError, qualifies', () => {
        const log = (...outcomes: string[]) => outcomes.map((outcome, id) => ({ id, outcome }));
        expect(deniedAfterPress(log('NotAllowedError'), 1), 'an earlier rejection on the page').toBe(false);
        expect(deniedAfterPress(log('granted', 'NotReadableError'), 1), 'this press failed for another reason').toBe(false);
        expect(deniedAfterPress(log('granted', 'NotAllowedError'), 1)).toBe(true);
        expect(deniedAfterPress([], 0), 'no acquisition at all').toBe(false);
        // Sam's control: an OLD pending acquisition (id 0) settles NotAllowedError after the press, while this press's own
        // acquisition (id 1) rejects NotReadableError — settlement order cannot qualify it.
        expect(deniedAfterPress([{ id: 0, outcome: 'NotAllowedError' }, { id: 1, outcome: 'NotReadableError' }], 1)).toBe(false);
        // A later retry's denial cannot qualify a press whose own acquisition failed otherwise.
        expect(deniedAfterPress(log('NotReadableError', 'NotAllowedError'), 0)).toBe(false);
    });

    it('item 10: on a cold device, any model work before the lease refusal — even a status that returned — is a FAIL', () => {
        const clean = { cold: true, modelRequests: 0, statusHistory: [] as string[], statusAtRefusal: 'download-required' };
        expect(modelWorkBeforeRefusal(clean)).toBe(false);
        expect(modelWorkBeforeRefusal({ ...clean, modelRequests: 1 }), 'a model-asset request').toBe(true);
        expect(modelWorkBeforeRefusal({ ...clean, statusHistory: ['loading', 'download-required'] }), 'loading → download-required').toBe(true);
        expect(modelWorkBeforeRefusal({ ...clean, statusAtRefusal: 'loading' })).toBe(true);
        expect(modelWorkBeforeRefusal({ ...clean, cold: false, modelRequests: 3 }), 'a warm device has its model already').toBe(false);
    });

    it('item 8: the two-device fault phase closes after the take-over row, before device B records and saves', () => {
        const src = readFileSync('tests/live/rwt-abandon-and-two-tabs.live.spec.ts', 'utf8');
        const takeOverRow = src.indexOf("receipt.row('take-over moves the one engine'");
        const close = src.indexOf('watch.setFaultPhase(false);', takeOverRow);
        const bStops = src.indexOf("stopBenchmarkRecording(deviceB, 'two-tab-b'", takeOverRow);
        expect(takeOverRow).toBeGreaterThan(0);
        expect(close).toBeGreaterThan(takeOverRow);
        expect(close).toBeLessThan(bStops);
    });

    it('item 2: a stalled or throwing step is isolated — later steps, cleanup and the receipt still run; report names it', async () => {
        vi.useFakeTimers();
        try {
            const h = fakes(async () => null);
            const steps = new FinalizationSteps();
            const ran: string[] = [];
            const hung = steps.step('watchdog', () => new Promise<void>(() => { /* never settles */ }), 1_000);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(await hung).toBeUndefined();
            expect(await steps.step('coaching settle', () => { throw new Error('closed context'); })).toBeUndefined();
            await steps.step('run-owned cleanup', async () => { ran.push('cleanup'); }, 10, { critical: true });
            ran.push('receipt');
            steps.report(h.receipt as never);
            expect(ran).toEqual(['cleanup', 'receipt']);
            expect(h.rows).toEqual([{ step: 'journey finalization', verdict: 'HOLD', evidence: { watchdog: 'timeout', 'coaching settle': 'error' } }]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('item 2: cleanup that does not complete is a FAIL; a clean finalization writes no row', async () => {
        vi.useFakeTimers();
        try {
            const h = fakes(async () => null);
            const steps = new FinalizationSteps();
            const cleanup = steps.step('run-owned cleanup', () => new Promise<void>(() => { /* hangs */ }), 1_000, { critical: true });
            await vi.advanceTimersByTimeAsync(1_000);
            await cleanup;
            steps.report(h.receipt as never);
            expect(h.rows).toEqual([expect.objectContaining({ step: 'journey finalization', verdict: 'FAIL' })]);
        } finally {
            vi.useRealTimers();
        }
        const ok = fakes(async () => null);
        const clean = new FinalizationSteps();
        expect(await clean.step('watchdog', () => 7)).toBe(7);
        clean.report(ok.receipt as never);
        expect(ok.rows).toEqual([]);
    });

    it('item 2: the coaching settle step allows the settle\'s own Edge bound plus slack — never cutting it short', () => {
        expect(FINALIZE_SETTLE_MS).toBeGreaterThan(COACHING_SETTLE_BOUND_MS);
    });
});

describe('#1662 Codex on f527a033 — each fault phase brackets exactly its injection', () => {
    const read = (f: string) => readFileSync(f, 'utf8');

    it('P1: the model-fault phase opens BEFORE the fault is injected (route abort, going offline)', () => {
        const src = read('tests/live/rwt-adverse-mic-model.live.spec.ts');
        for (const inject of ["await context.route(MODEL_ASSETS, (route) => route.abort('failed'));", 'await context.setOffline(true);']) {
            const at = src.indexOf(inject);
            expect(at).toBeGreaterThan(0);
            expect(src.lastIndexOf('watch.setFaultPhase(true);', at), `${inject} — opened before`).toBeGreaterThan(src.lastIndexOf('watch.setFaultPhase(false);', at));
        }
    });

    it('P2: the save-fault phase closes BEFORE Retry Save is pressed', () => {
        const src = read('tests/live/rwt-save-retry-recovery.live.spec.ts');
        const retry = src.indexOf("await page.getByTestId('session-retry-save').click();");
        expect(src.lastIndexOf('watch.setFaultPhase(false);', retry)).toBeGreaterThan(src.lastIndexOf('watch.setFaultPhase(true);', retry));
    });
});

/**
 * Sam's consolidated RETURN on f527a033 (01:41). Each control reproduces a gap at f527a033 and must hold on the successor.
 */
describe('#1662 RETURN on f527a033 — one owned deletion, bounded closes, boot identity, event-time prohibition, scoped allowances', () => {
    const fakes = (domState: () => Promise<DomState | null> = async () => null) => {
        const closed: string[] = [];
        const page = { context: () => ({ close: async () => { closed.push('main'); } }), evaluate: domState };
        const tap = { events: [] as object[] };
        const rows: { step: string; verdict: string; evidence?: unknown }[] = [];
        const receipt = { rows, row: (step: string, verdict: string, _detail: string, evidence?: unknown) => { rows.push({ step, verdict, evidence }); } };
        return { closed, page, tap, rows, receipt };
    };
    const quiet = { log: () => undefined, label: 'case' };
    const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };

    it('item 1: a timed-out proof never starts a second deletion; the ONE deletion\'s own settlement decides', async () => {
        vi.useFakeTimers();
        try {
            const h = fakes();
            let deletions = 0;
            const gate = deferred();
            const cleanup = new OwnedCleanup(async () => { deletions += 1; await gate.promise; return 'uid'; });
            const steps = new FinalizationSteps();
            // The retention proof deletes through the cleanup, which outlives the proof's bound.
            const done = finalizeOwnedCleanup(steps, h.receipt as never, cleanup, async () => { await cleanup.run(); });
            await vi.advanceTimersByTimeAsync(FINALIZE_CLEANUP_MS);
            gate.resolve(); // the SAME deletion completes during the settlement's grace
            expect(await done).toBe('deleted');
            expect(deletions, 'one deletion, never a second').toBe(1);
            steps.report(h.receipt as never);
            expect(h.rows.map((r) => [r.step, r.verdict])).toEqual([['run-owned cleanup', 'PASS'], ['journey finalization', 'HOLD']]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('item 1: a deletion that completed while its retention readback stalled is NOT deleted again; the readback is a HOLD, not a FAIL', async () => {
        vi.useFakeTimers();
        try {
            const h = fakes();
            let deletions = 0;
            const cleanup = new OwnedCleanup(async () => { deletions += 1; return 'uid'; });
            const steps = new FinalizationSteps();
            const done = finalizeOwnedCleanup(steps, h.receipt as never, cleanup, async () => {
                await cleanup.run();
                await new Promise<void>(() => { /* the retention readback never answers */ });
            });
            await vi.advanceTimersByTimeAsync(FINALIZE_CLEANUP_MS);
            expect(await done).toBe('deleted');
            expect(deletions).toBe(1);
            steps.report(h.receipt as never);
            expect(h.rows.find((r) => r.step === 'journey finalization')).toMatchObject({ verdict: 'HOLD', evidence: { 'run-owned cleanup proof': 'timeout' } });
            expect(h.rows.find((r) => r.step === 'run-owned cleanup')?.verdict).toBe('PASS');
        } finally {
            vi.useRealTimers();
        }
    });

    it('item 1: a deletion that never settles is a FAIL with residue unproven', async () => {
        vi.useFakeTimers();
        try {
            const h = fakes();
            const cleanup = new OwnedCleanup(() => new Promise<string>(() => { /* hangs */ }));
            const steps = new FinalizationSteps();
            const done = finalizeOwnedCleanup(steps, h.receipt as never, cleanup);
            await vi.advanceTimersByTimeAsync(FINALIZE_CLEANUP_MS);
            expect(await done).toBe('pending');
            steps.report(h.receipt as never);
            expect(h.rows.map((r) => [r.step, r.verdict])).toEqual([['run-owned cleanup', 'FAIL'], ['journey finalization', 'FAIL']]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('item 1: a step that outlives its bound cannot write a row or flip state afterwards, nor after the report seals', async () => {
        vi.useFakeTimers();
        try {
            const h = fakes();
            const steps = new FinalizationSteps();
            const late = deferred();
            let accountDeleted = false;
            const step = steps.step('run-owned cleanup proof', async (alive) => {
                await late.promise;
                aliveReceipt(h.receipt as never, alive).row('feedback retention', 'PASS', 'late');
                if (alive()) accountDeleted = true;
            }, 1_000);
            await vi.advanceTimersByTimeAsync(1_000);
            await step;
            late.resolve();
            await vi.advanceTimersByTimeAsync(0);
            expect(h.rows).toEqual([]);
            expect(accountDeleted).toBe(false);

            const sealed = new FinalizationSteps();
            let after = true;
            const pending = deferred();
            const running = sealed.step('telemetry rows', async (alive) => { await pending.promise; after = alive(); });
            sealed.report(h.receipt as never); // the receipt is about to be written
            pending.resolve();
            await running;
            expect(after, 'sealed: no mutation after the report').toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('item 2: the two-device finalizer closes each device in its own bounded step', () => {
        const src = readFileSync('tests/live/rwt-abandon-and-two-tabs.live.spec.ts', 'utf8');
        const at = src.lastIndexOf('const finish = finalizer.once(');
        const closure = src.slice(at, src.indexOf('\n        });', at));
        expect(closure).toContain("await steps.step('same-browser tab close', () => sameBrowserTab?.close());");
        expect(closure).toContain("await steps.step('other device close', () => otherDevice?.close());");
        expect(closure).not.toMatch(/await (sameBrowserTab|otherDevice)\?\.close\(\)/);
    });

    it('item 3: on a watched page at this release, a boot that is not that document\'s boot is foreign', async () => {
        const h = fakes();
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {}, releaseSha: 'a'.repeat(40) });
        const failed = () => ({ event: 'session_save_latency_measured', at: Date.now(), releaseSha: 'a'.repeat(40), watch: { outcome: 'failed' } });
        h.tap.events.push(sentBy(h.page, { event: 'journey_step', at: Date.now() }, { boot: 'boot-A', document: 0 }));
        h.tap.events.push(sentBy(h.page, { event: 'session_save_latency_measured', at: Date.now(), releaseSha: 'a'.repeat(40), watch: { outcome: 'saved' } }, { boot: 'boot-A', document: 0 }));
        expect(await w.tick()).toBeNull();
        h.tap.events.push(sentBy(h.page, failed(), { boot: 'boot-X', document: 0 })); // a foreign boot on the same document
        h.tap.events.push(sentBy(h.page, failed(), { boot: 'boot-A', document: 1 })); // boot A cannot speak for the next load
        const missing = sentBy(h.page, failed(), { boot: 'boot-A', document: 0 });
        delete (missing as { bootId?: string }).bootId;
        h.tap.events.push(missing); // no boot identity at all
        expect(await w.tick(), 'foreign boots never trip').toBeNull();
        expect(h.closed).toEqual([]);
        h.tap.events.push(sentBy(h.page, failed(), { boot: 'boot-B', document: 1 })); // the page's next load, its own boot
        expect(await w.tick(), 'the next document\'s own boot is this journey').toMatchObject({ kind: 'save_failed' });
    });

    it('item 4: a RECORDING captured while forbidden but scanned after the prohibition cleared still trips', async () => {
        const h = fakes();
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        w.setForbidRecording(true);
        const during = Date.now();
        await new Promise((r) => setTimeout(r, 2));
        w.setForbidRecording(false);
        h.tap.events.push(sentBy(h.page, { event: 'recording_state', at: during, watch: { to_state: 'RECORDING' } }));
        expect(await w.tick()).toMatchObject({ kind: 'recording_while_forbidden' });
        const h2 = fakes();
        const w2 = new JourneyWatchdog({ ...quiet, page: h2.page as never, tap: h2.tap as never, profile: {} });
        w2.setForbidRecording(true);
        w2.setForbidRecording(false);
        h2.tap.events.push(sentBy(h2.page, { event: 'recording_state', at: Date.now() + 5, watch: { to_state: 'RECORDING' } }));
        expect(await w2.tick(), 'a recording after the step is allowed').toBeNull();
    });

    it('item 4: an event without a capture time earns no phase allowance', async () => {
        const h = fakes();
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: { allowSaveFailed: true } });
        w.setFaultPhase(true);
        // The boot is established by its document's own timed event; its untimed failure is then judged strictly.
        h.tap.events.push(sentBy(h.page, { event: 'journey_step', at: Date.now() }));
        h.tap.events.push(sentBy(h.page, { event: 'session_save_latency_measured', at: Date.now(), watch: { outcome: 'failed' } }, { noCaptureTime: true }));
        expect(await w.tick()).toMatchObject({ kind: 'save_failed' });
    });

    it('item 4: a fatal event that arrives during record()\'s final DOM drain is judged before the row', async () => {
        const read = deferred();
        const h = fakes(async () => { await read.promise; return { runtimeState: 'READY', modelStatus: 'ready', control: 'mic-start', controlEnabled: true }; });
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        void w.tick(); // a DOM read is in flight
        const recording = w.record(h.receipt as never);
        h.tap.events.push(sentBy(h.page, { event: 'recording_state', at: Date.now(), watch: { to_state: 'FAILED', failure_code: 'engine_error' } }));
        read.resolve();
        await recording;
        expect(h.rows.map((r) => r.verdict)).toEqual(['FAIL']);
        expect(h.closed, 'finalization records the signal without closing the pages it still reads').toEqual([]);
    });

    it('item 7: the displacement allowance excuses only tab A; device B\'s own lease failure trips, its first refusal does not', async () => {
        const h = fakes();
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: watchProfileFor('abandon-and-two-tabs-take-over') });
        const deviceB = { context: () => ({ close: async () => undefined }), evaluate: async () => null };
        w.setFaultPhase(true);
        w.setPage(deviceB as never);
        w.scopeFailureAllowance([h.page]);
        const leaseFailed = () => ({ event: 'recording_state', at: Date.now(), watch: { to_state: 'FAILED', failure_code: 'lease_not_held' } });
        h.tap.events.push(sentBy(h.page, leaseFailed())); // tab A displaced: expected
        h.tap.events.push(sentBy(deviceB, { event: 'session_start_latency_measured', at: Date.now(), watch: { outcome: 'refused' } })); // B's first press
        expect(await w.tick()).toBeNull();
        h.tap.events.push(sentBy(deviceB, { ...leaseFailed(), at: Date.now() + 1 })); // B's OWN take fails with a lease code
        expect(await w.tick()).toMatchObject({ kind: 'recording_failed', fields: { failure_code: 'lease_not_held' } });
    });
});

describe('#1662 Codex on 76a0bf6e — a hung download is bounded; device closes are reported', () => {
    const loading = (progress: number | null): DomState => ({ runtimeState: 'DOWNLOAD_REQUIRED', modelStatus: 'loading', control: 'mic-download', controlEnabled: false, progress });

    it('P2: a download whose readable percentage stops moving is a stall; a slow one that advances is not', async () => {
        expect(stallOf(loading(42), STALL_MS.DOWNLOAD_NO_PROGRESS + 1)).toBe('download_stuck');
        expect(stallOf(loading(42), STALL_MS.DOWNLOAD_NO_PROGRESS)).toBeNull();
        expect(stallOf(loading(null), STALL_MS.DOWNLOAD_NO_PROGRESS + 1), 'no readable percentage: only the long bound').toBeNull();
        expect(stallOf(loading(null), STALL_MS.DOWNLOAD_UNREADABLE + 1)).toBe('download_stuck');
        expect(STALL_MS.DOWNLOAD_UNREADABLE, 'never shorter than the 900 s cold wait').toBeGreaterThan(900_000);
        // Through the watchdog: a moving percentage restarts the clock; a frozen one trips.
        let pct = 10;
        const page = { context: () => ({ close: async () => undefined }), evaluate: async () => loading(pct) };
        const w = new JourneyWatchdog({ page: page as never, tap: { events: [] } as never, profile: {}, label: 'case', log: () => undefined });
        const t0 = Date.now();
        expect(await w.tick(t0)).toBeNull();
        pct = 11;
        expect(await w.tick(t0 + STALL_MS.DOWNLOAD_NO_PROGRESS), 'progress moved').toBeNull();
        expect(await w.tick(t0 + 2 * STALL_MS.DOWNLOAD_NO_PROGRESS + 1)).toMatchObject({ kind: 'download_stuck', fields: { progress: 11 } });
    });

    it('P2: the two-device closes run before the report seals the finalization', () => {
        const src = readFileSync('tests/live/rwt-abandon-and-two-tabs.live.spec.ts', 'utf8');
        const fn = src.slice(src.indexOf('async function finishJourney('), src.indexOf('async function abandonAndReturn('));
        expect(fn.indexOf('if (beforeReport) await beforeReport();')).toBeGreaterThan(-1);
        expect(fn.indexOf('if (beforeReport) await beforeReport();')).toBeLessThan(fn.indexOf('steps.report(receipt);'));
        const at = src.lastIndexOf('const finish = finalizer.once(');
        const closure = src.slice(at, src.indexOf('\n        });', at));
        expect(closure.indexOf("steps.step('other device close'")).toBeGreaterThan(closure.indexOf('await finishJourney('));
        expect(closure.indexOf("steps.step('other device close'")).toBeLessThan(closure.lastIndexOf('});'));
        expect(closure).toMatch(/await finishJourney\([^)]*steps, async \(\) => \{/);
    });
});

describe('#1662 RETURN on 76a0bf6e — committed-document boot identity; download stall negative controls', () => {
    const fakes = () => {
        const closed: string[] = [];
        const page = { context: () => ({ close: async () => { closed.push('main'); } }), evaluate: async () => null };
        return { closed, page, tap: { events: [] as object[] } };
    };
    const quiet = { log: () => undefined, label: 'case' };
    const failed = (at = Date.now()) => ({ event: 'session_save_latency_measured', at, watch: { outcome: 'failed' } });

    it('item 1: an aborted navigation leaves the original document current — its boot\'s failure still trips', async () => {
        // The tap advances the document only on a navigation that received its response AND committed; an aborted one
        // leaves the stamp at the original document, so the original boot keeps its binding.
        const h = fakes();
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        h.tap.events.push(sentBy(h.page, { event: 'journey_step', at: Date.now() }, { boot: 'boot-A', document: 0 }));
        expect(await w.tick()).toBeNull();
        h.tap.events.push(sentBy(h.page, failed(), { boot: 'boot-A', document: 0 })); // still document 0
        expect(await w.tick()).toMatchObject({ kind: 'save_failed' });
    });

    it('item 1: a foreign first arrival cannot poison the document; the genuine boot\'s failure still trips', async () => {
        const h = fakes();
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        const committedAt = Date.now();
        // The previous document's boot, captured BEFORE document 1's response, arrives first stamped with document 1.
        h.tap.events.push(sentBy(h.page, failed(committedAt - 500), { boot: 'boot-OLD', document: 1, documentAt: committedAt }));
        expect(await w.tick(), 'an earlier document\'s event never binds or trips').toBeNull();
        h.tap.events.push(sentBy(h.page, { event: 'journey_step', at: committedAt + 50 }, { boot: 'boot-NEW', document: 1, documentAt: committedAt }));
        h.tap.events.push(sentBy(h.page, failed(committedAt + 100), { boot: 'boot-NEW', document: 1, documentAt: committedAt }));
        expect(await w.tick(), 'the committed document\'s own boot').toMatchObject({ kind: 'save_failed' });
    });

    it('item 1: a boot established on one document can never claim the next (unload beacons of the old boot)', async () => {
        const h = fakes();
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: {} });
        const t = Date.now();
        h.tap.events.push(sentBy(h.page, { event: 'journey_step', at: t }, { boot: 'boot-A', document: 0 }));
        expect(await w.tick()).toBeNull();
        // boot-A's late beacon, captured after document 1's response and stamped document 1, arrives first.
        h.tap.events.push(sentBy(h.page, failed(t + 200), { boot: 'boot-A', document: 1, documentAt: t + 100 }));
        expect(await w.tick()).toBeNull();
        h.tap.events.push(sentBy(h.page, failed(t + 300), { boot: 'boot-B', document: 1, documentAt: t + 100 }));
        expect(await w.tick(), 'document 1 still belongs to its own boot').toMatchObject({ kind: 'save_failed' });
    });

    it('item 1: the tap derives each event\'s document from its page\'s lifetime tracker, proven by the RWT CDP session', () => {
        const src = readFileSync('tests/live/helpers/rwtJourney.ts', 'utf8');
        expect(src).toContain('const documents = documentTrackerOf(page);');
        expect(src).toContain("Object.defineProperty(this.events[i], 'sourceDocumentRef', { value: ref, enumerable: false });");
        expect(src).toContain('documents.refFor(request.url(), body)');
        // Never part of the transport listener set that detach / re-attach removes.
        expect(src).not.toMatch(/this\.listeners\.push\(\['(response|framenavigated)'/);
        // The fixture's page-lifetime CDP session is the proven commit source, before the page's first navigation.
        const identity = readFileSync('tests/live/helpers/rwtBrowserIdentity.ts', 'utf8');
        expect(identity).toContain('await trackDocuments(page, cdp);');
    });

    it('stall controls: genuine slow progress never trips; absent progress uses only the long bound; transitions restart the clock', async () => {
        const at = { pct: 1 as number | null, model: 'loading' };
        const page = { context: () => ({ close: async () => undefined }),
            evaluate: async () => ({ runtimeState: 'DOWNLOAD_REQUIRED', modelStatus: at.model, control: 'mic-download', controlEnabled: false, progress: at.pct }) };
        const w = new JourneyWatchdog({ ...quiet, page: page as never, tap: { events: [] } as never, profile: {} });
        const t0 = Date.now();
        // Genuine slow progress: one percent every 170 s, for 20 steps (~57 min) — never a stall.
        for (let i = 0; i < 20; i += 1) {
            at.pct = 1 + i;
            expect(await w.tick(t0 + i * 170_000)).toBeNull();
        }
        // Progress becomes unreadable: the long bound applies from the transition, not the short one.
        const t1 = t0 + 20 * 170_000;
        at.pct = null;
        expect(await w.tick(t1)).toBeNull();
        expect(await w.tick(t1 + STALL_MS.DOWNLOAD_NO_PROGRESS + 1), 'unreadable progress is not frozen progress').toBeNull();
        // Ready, then loading again: the clock restarts at each transition.
        at.model = 'ready';
        expect(await w.tick(t1 + STALL_MS.DOWNLOAD_UNREADABLE - 1)).toBeNull();
        at.model = 'loading';
        at.pct = 30;
        const t2 = t1 + STALL_MS.DOWNLOAD_UNREADABLE;
        expect(await w.tick(t2)).toBeNull();
        expect(await w.tick(t2 + STALL_MS.DOWNLOAD_NO_PROGRESS), 'exactly at the bound').toBeNull();
        expect(await w.tick(t2 + STALL_MS.DOWNLOAD_NO_PROGRESS + 1)).toMatchObject({ kind: 'download_stuck', fields: { progress: 30 } });
    });
});

describe('#1662 RETURN on 46ebed0f — transfer-only download stall', () => {
    const dom = (o: Partial<DomState>): DomState => ({ runtimeState: 'DOWNLOAD_REQUIRED', modelStatus: 'loading', control: 'mic-download', controlEnabled: false, progress: 40, ...o });

    it('item 1: engine initialization (loading, bar left at 100 %) keeps its 960 s budget — never the 180 s transfer rule', () => {
        const init = dom({ runtimeState: 'ENGINE_INITIALIZING', progress: 100 });
        expect(stallOf(init, STALL_MS.DOWNLOAD_NO_PROGRESS + 1), 'Sam\'s control: 180 001 ms of initialization').toBeNull();
        expect(stallOf(init, STALL_MS.ENGINE_INITIALIZING), 'at the initialization budget').toBeNull();
        expect(stallOf(init, STALL_MS.ENGINE_INITIALIZING + 1), 'past the initialization budget').toBe('engine_init_stuck');
        // Initializing with no readable bar is the same phase.
        expect(stallOf(dom({ runtimeState: 'ENGINE_INITIALIZING', progress: null }), STALL_MS.DOWNLOAD_UNREADABLE - 1)).toBeNull();
    });

    it('item 1: a completed transfer (100 %) still loading outside ENGINE_INITIALIZING is initialization, below and above budget', () => {
        expect(stallOf(dom({ progress: 100 }), STALL_MS.DOWNLOAD_NO_PROGRESS + 1)).toBeNull();
        expect(stallOf(dom({ progress: 100 }), STALL_MS.ENGINE_INITIALIZING)).toBeNull();
        expect(stallOf(dom({ progress: 100 }), STALL_MS.ENGINE_INITIALIZING + 1)).toBe('engine_init_stuck');
    });

    it('item 1: a TRANSFER whose readable percentage is frozen is still bounded at 180 s', () => {
        expect(stallOf(dom({ progress: 99 }), STALL_MS.DOWNLOAD_NO_PROGRESS)).toBeNull();
        expect(stallOf(dom({ progress: 99 }), STALL_MS.DOWNLOAD_NO_PROGRESS + 1)).toBe('download_stuck');
        expect(stallOf(dom({ progress: null }), STALL_MS.DOWNLOAD_UNREADABLE + 1)).toBe('download_stuck');
    });
});

/**
 * Sam, #1662 RETURNs on 2cab5b0c / 65dd8b8f — an event's document is the loader the BROWSER says sent its request, and the
 * document's start is the browser's own `init` on the browser's clock. The fake below is a page's Playwright events plus its
 * page-lifetime CDP session: a commit emits `init` + `Page.frameNavigated`; a PostHog send emits the Playwright request and
 * the CDP `Network.requestWillBeSent` (each order, or one side only). The browser's wall clock runs 500 ms BEHIND the host's,
 * so any boundary taken from a host callback misclassifies a valid early capture (Sam's 65dd schedule 1).
 */
describe('#1662 RETURNs on 2cab5b0c / 65dd8b8f — browser-stated request provenance; incomplete provenance never PASSes', () => {
    const quiet = { log: () => undefined, label: 'case' };
    class FakeCdp extends EventEmitter {
        postData: (requestId: string) => Promise<unknown> = () => Promise.reject(new Error('no body'));
        async send(method: string, params?: { requestId?: string }): Promise<unknown> {
            if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', loaderId: 'L0' } } };
            if (method === 'Network.getRequestPostData') return this.postData(params?.requestId ?? '');
            return {};
        }
    }
    class CdpTab extends EventEmitter {
        readonly frame: { url: () => string } = { url: () => 'about:blank' };
        closed = false;
        mainFrame() { return this.frame; }
        context() { return { close: async () => undefined }; }
        isClosed() { return this.closed; }
        async evaluate() { return null; }
    }
    type Sent = { event: string; boot: string; at: number; props?: Record<string, string> };
    /** One browser: its monotonic clock (s), its wall clock 500 ms behind the host, one page and that page's CDP session. */
    class Browser {
        readonly page = new CdpTab();
        readonly cdp = new FakeCdp();
        private mono = 5_000;
        private readonly offsetS = (Date.now() - 500) / 1000 - 5_000;
        private seq = 0;
        wallMs(): number { return (this.mono + this.offsetS) * 1000; }
        /** Moves the clock so the next instant is exactly half-way through a wall-clock millisecond (N + 0.5 ms). */
        toHalfMillisecond(): void { const w = this.wallMs(); this.advance(Math.floor(w) + 1.5 - w); }
        advance(ms: number): void { this.mono += ms / 1000; }
        /** A cross-document commit: `init` on the browser clock, then the commit; Playwright reports it too. */
        commit(loaderId: string, frameId = 'main'): void {
            this.cdp.emit('Page.lifecycleEvent', { frameId, loaderId, name: 'init', timestamp: this.mono });
            this.cdp.emit('Page.frameNavigated', { frame: frameId === 'main' ? { id: 'main', loaderId } : { id: frameId, parentId: 'main', loaderId } });
            this.page.emit('framenavigated', this.page.frame);
            this.advance(50); // the new document's code runs well after its start
        }
        /** A same-document change: Playwright only (CDP reports it as navigatedWithinDocument, never a boundary). */
        sameDocument(url: string): void { this.page.frame.url = () => url; this.page.emit('framenavigated', this.page.frame); }
        /** A PostHog batch sent by `loaderId`. */
        send(loaderId: string, events: Sent[], o: { order?: 'pw-first' | 'cdp-first' | 'pw-only' | 'cdp-only'; url?: string; inline?: boolean } = {}) {
            const id = String(++this.seq);
            const url = o.url ?? `https://us.i.posthog.com/e/?_=${id}`;
            const body = Buffer.from(JSON.stringify(events.map((e) => ({ event: e.event, timestamp: new Date(e.at).toISOString(), properties: { boot_id: e.boot, ...e.props } }))));
            const pw = () => this.page.emit('request', { url: () => url, method: () => 'POST', isNavigationRequest: () => false, frame: () => ({}),
                postDataBuffer: () => body, response: () => Promise.resolve({ status: () => 200 }), failure: () => null });
            const inline = o.inline !== false;
            const cdp = () => this.cdp.emit('Network.requestWillBeSent', { requestId: id, loaderId, timestamp: this.mono, wallTime: this.mono + this.offsetS,
                request: { url, method: 'POST', hasPostData: true, ...(inline ? { postDataEntries: [{ bytes: body.toString('base64') }] } : {}) } });
            const order = o.order ?? 'pw-first';
            if (order !== 'cdp-only') { if (order === 'cdp-first') { cdp(); pw(); } else pw(); }
            if (order === 'pw-first') cdp();
            if (order === 'cdp-only') cdp();
            this.advance(1);
            return { cdp, pw, body, id };
        }
    }
    const step = (boot: string, at: number): Sent => ({ event: 'journey_step', boot, at });
    const saveFailed = (boot: string, at: number): Sent => ({ event: 'session_save_latency_measured', boot, at, props: { outcome: 'failed' } });
    /** A watched, non-fatal event, so the journey counts as observed. */
    const saved = (boot: string, at: number): Sent => ({ event: 'session_save_latency_measured', boot, at, props: { outcome: 'saved' } });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    /** A tracked, watched page on document L1 with boot-1 established; optionally the tap then moves to page B. */
    const setup = async (o: { viaB?: boolean; track?: boolean } = {}) => {
        const b = new Browser();
        if (o.track !== false) await trackDocuments(b.page as never, b.cdp as never);
        b.commit('L1');
        const tap = new AnalyticsTap();
        tap.attach(b.page as never);
        const w = new JourneyWatchdog({ ...quiet, page: b.page as never, tap: tap as never, profile: {} });
        b.send('L1', [step('boot-1', b.wallMs())]);
        expect(await w.tick()).toBeNull();
        if (o.viaB) { const other = new Browser(); await trackDocuments(other.page as never, other.cdp as never); tap.attach(other.page as never); w.setPage(other.page as never); }
        return { b, w };
    };
    const recordRows = async (w: JourneyWatchdog) => {
        const rows: { verdict: string; evidence?: Record<string, unknown> }[] = [];
        await w.record({ row: (_s: string, verdict: string, _d: string, evidence?: Record<string, unknown>) => { rows.push({ verdict, evidence }); } } as never);
        return rows;
    };

    it('positive control: a clean journey with every request joined finishes PASS', async () => {
        const { b, w } = await setup();
        b.send('L1', [saved('boot-1', b.wallMs())], { order: 'cdp-first' });
        expect(await w.tick()).toBeNull();
        expect(await recordRows(w)).toEqual([expect.objectContaining({ verdict: 'PASS', evidence: expect.objectContaining({ unattributedRequests: 0, provenanceConflicts: 0, unprovenPages: 0 }) })]);
    });

    for (const viaB of [false, true]) {
        const path = viaB ? 'A → attach B → reload A' : 'single page';
        for (const order of ['pw-first', 'cdp-first'] as const) {
            it(`${path} — 65dd #1 (${order}): a new-boot fatal captured just after the browser's init, before any host callback time, trips`, async () => {
                const { b, w } = await setup({ viaB });
                const start = b.wallMs();
                b.commit('L2');
                // 3 ms after the browser's start (outside the boundary), and before any host-callback time.
                b.send('L2', [saveFailed('boot-2', start + 3)], { order });
                expect(await w.tick(), 'the browser clock, not the host callback, bounds the document').toMatchObject({ kind: 'save_failed' });
            });
        }

        it(`${path} — 2cab #1/#2: superseded/aborted navigations and same-URL hash notifications never move the document`, async () => {
            const { b, w } = await setup({ viaB });
            b.sameDocument('https://app.test/session#review');
            b.sameDocument('https://app.test/session');
            b.send('L1', [saveFailed('boot-1', b.wallMs())]);
            expect(await w.tick(), 'the original document\'s fatal').toMatchObject({ kind: 'save_failed' });
        });
    }

    it('proven old-document exclusion: the browser sends a request from a loader the page already left (replaced)', async () => {
        const { b, w } = await setup();
        b.commit('L2');
        b.send('L1', [saveFailed('boot-1', b.wallMs())]); // a late unload beacon after the next commit (cross-process)
        expect(await w.tick(), 'old-document evidence is excluded').toBeNull();
        b.send('L2', [saveFailed('boot-2', b.wallMs())]);
        expect(await w.tick()).toMatchObject({ kind: 'save_failed' });
    });

    it('gate B: an earlier boot\'s queued events flushed by the new loader neither claim its boot nor suppress its fatal', async () => {
        const b = new Browser();
        await trackDocuments(b.page as never, b.cdp as never);
        b.commit('L1');
        const tap = new AnalyticsTap();
        tap.attach(b.page as never);
        const w = new JourneyWatchdog({ ...quiet, page: b.page as never, tap: tap as never, profile: {} });
        const before = b.wallMs(); // boot-1 captured on L1 but never sent there
        b.advance(20);
        b.commit('L2');
        b.send('L2', [saveFailed('boot-1', before), step('boot-2', b.wallMs())]); // a mixed batch: old queued + current
        expect(await w.tick(), 'the old capture predates L2: it cannot bind L2 or fail this document').toBeNull();
        b.send('L2', [saveFailed('boot-2', b.wallMs())]);
        expect(await w.tick(), 'the new boot still owns L2').toMatchObject({ kind: 'save_failed' });
    });

    for (const late of ['record', 'request'] as const) {
        it(`gate A: a delayed duplicate ${late} for the same URL+body makes the pairing a conflict — HOLD, never first-come`, async () => {
            const { b, w } = await setup();
            const url = 'https://us.i.posthog.com/e/?_=dup';
            const sent = b.send('L1', [step('boot-1', b.wallMs())], { url });
            expect(await w.tick()).toBeNull();
            if (late === 'record') sent.cdp(); else sent.pw(); // the second candidate arrives after an apparent single match
            const rows = await recordRows(w);
            expect(rows).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ provenanceConflicts: 1 }) })]);
        });
    }

    it('gate A: duplicate records from DIFFERENT loaders before the request — no document is assigned', async () => {
        const { b, w } = await setup();
        b.commit('L2');
        const url = 'https://us.i.posthog.com/e/?_=x';
        const first = b.send('L2', [saveFailed('boot-9', b.wallMs())], { url, order: 'cdp-only' });
        b.cdp.emit('Network.requestWillBeSent', { requestId: 'z', loaderId: 'L1', timestamp: 5_100, wallTime: 1, request: { url, method: 'POST', postDataEntries: [{ bytes: first.body.toString('base64') }] } });
        first.pw();
        expect(await w.tick(), 'unknown boot, no proven document').toBeNull();
        expect(await recordRows(w)).toEqual([expect.objectContaining({ verdict: 'HOLD' })]);
    });

    it('gate C: a body the browser did not inline is fetched and joins; a refused fetch stays unattributed (HOLD)', async () => {
        const ok = await setup();
        ok.b.cdp.postData = async () => ({ postData: '' });
        ok.b.commit('L2');
        const sent = ok.b.send('L2', [saveFailed('boot-2', ok.b.wallMs())], { inline: false, order: 'pw-only' });
        ok.b.cdp.postData = async () => ({ postData: sent.body.toString('base64'), base64Encoded: true });
        sent.cdp();
        await flush();
        expect(await ok.w.tick()).toMatchObject({ kind: 'save_failed' });
        const refused = await setup();
        refused.b.commit('L2');
        refused.b.send('L2', [saveFailed('boot-2', refused.b.wallMs())], { inline: false });
        await flush();
        expect(await refused.w.tick()).toBeNull();
        expect(await recordRows(refused.w)).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ unattributedRequests: 1 }) })]);
    });

    it('a81f #1: a body fetched AFTER the next commit keeps the origin the browser reported — the current fatal trips', async () => {
        const { b, w } = await setup();
        let release!: (v: unknown) => void;
        b.cdp.postData = () => new Promise((r) => { release = r; });
        const sent = b.send('L1', [saveFailed('boot-1', b.wallMs())], { inline: false }); // L1 is current when it is sent
        b.commit('L2'); // the next document commits while the bytes are being fetched
        release({ postData: sent.body.toString('base64'), base64Encoded: true });
        await flush();
        expect(await w.tick(), 'sent by the then-current L1: not replaced').toMatchObject({ kind: 'save_failed' });
    });

    it('45c5: a browser clock-pair change while a body is fetched cannot move the document start — the new-boot fatal trips', async () => {
        const { b, w } = await setup();
        const start = b.wallMs();
        b.commit('L2');
        let release!: (v: unknown) => void;
        b.cdp.postData = () => new Promise((r) => { release = r; });
        const sent = b.send('L2', [saveFailed('boot-2', start + 3)], { inline: false });
        // Another request reports a monotonic/wall pairing 20 ms later before the body arrives.
        b.cdp.emit('Network.requestWillBeSent', { requestId: 'other', loaderId: 'L2', timestamp: 6_000, wallTime: 6_000 + (Date.now() - 500) / 1000 - 5_000 + 0.02,
            request: { url: 'https://app.test/other.js', method: 'GET' } });
        release({ postData: sent.body.toString('base64'), base64Encoded: true });
        await flush();
        expect(await w.tick(), 'the request-time mapping is the one that counts').toMatchObject({ kind: 'save_failed' });
    });

    it('a81f #2: a capture in the same millisecond as the document\'s fractional start is uncertain — never foreign', async () => {
        const { b, w } = await setup();
        b.toHalfMillisecond();
        const start = b.wallMs(); // N + 0.5
        b.commit('L2');
        b.send('L2', [saveFailed('boot-2', Math.floor(start))]); // a legitimate capture stamped N
        expect(await w.tick(), 'an unknown boot at the boundary binds nothing').toBeNull();
        const rows = await recordRows(w);
        expect(rows).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ foreignIgnored: 0, unresolvedIdentity: 1 }) })]);
    });

    it('a81f #2: a KNOWN boot at the boundary is judged as its own evidence (fail closed)', async () => {
        const { b, w } = await setup();
        b.toHalfMillisecond();
        const start = b.wallMs();
        b.commit('L2');
        b.send('L2', [saveFailed('boot-1', Math.floor(start))]);
        expect(await w.tick()).toMatchObject({ kind: 'save_failed' });
    });

    it('a81f #2: only a capture CLEARLY before the start is proven old (excluded); the new boot still trips', async () => {
        const { b, w } = await setup();
        const before = b.wallMs();
        b.advance(10);
        b.commit('L2');
        b.send('L2', [saveFailed('boot-1', before)]); // 10 ms before L2 began: an earlier document's queued event
        expect(await w.tick()).toBeNull();
        b.send('L2', [saveFailed('boot-2', b.wallMs())]);
        expect(await w.tick()).toMatchObject({ kind: 'save_failed' });
    });

    /** A Blob `sendBeacon`: the browser exposes no body to Playwright (or to CDP). */
    const blindBeacon = (page: CdpTab) => page.emit('request', { url: () => 'https://us.i.posthog.com/e/?beacon=1', method: () => 'POST', isNavigationRequest: () => false,
        frame: () => ({}), postDataBuffer: () => null, response: () => Promise.resolve({ status: () => 200 }), failure: () => null });

    it('Codex P1 r4314310162: a watched page\'s blind beacon in the window HOLDs the verdict — its signals are unknown', async () => {
        const { b, w } = await setup();
        b.send('L1', [saved('boot-1', b.wallMs())]);
        expect(await w.tick()).toBeNull();
        blindBeacon(b.page);
        expect(await recordRows(w)).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ blindBeacons: 1 }) })]);
    });

    it('Codex P1 r4314310162: an UNWATCHED page\'s blind beacon changes nothing; a decoded fatal still FAILs over a blind one', async () => {
        const { b, w } = await setup();
        b.send('L1', [saved('boot-1', b.wallMs())]);
        const other = new Browser();
        await trackDocuments(other.page as never, other.cdp as never);
        const tap = (w as unknown as { o: { tap: AnalyticsTap } }).o.tap;
        tap.attach(other.page as never);
        tap.attach(b.page as never);
        blindBeacon(other.page);
        expect(await recordRows(w)).toEqual([expect.objectContaining({ verdict: 'PASS', evidence: expect.objectContaining({ blindBeacons: 0 }) })]);
        const failing = await setup();
        blindBeacon(failing.b.page);
        failing.b.send('L1', [saveFailed('boot-1', failing.b.wallMs())]);
        expect(await recordRows(failing.w)).toEqual([expect.objectContaining({ verdict: 'FAIL' })]);
    });

    it('a request the browser never reports stays unattributed through the drain and record (HOLD)', async () => {
        const { b, w } = await setup();
        b.send('L1', [step('boot-1', b.wallMs())], { order: 'pw-only' });
        expect(await recordRows(w)).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ unattributedRequests: 1 }) })]);
    });

    it('65dd #2: session LOSS while the page is open → navigation → new fatal: HOLD; a replacement session is not an authority', async () => {
        const { b, w } = await setup();
        b.cdp.emit('Inspector.detached', { reason: 'test' });
        const replacement = new FakeCdp();
        await trackDocuments(b.page as never, replacement as never);
        expect(replacement.listenerCount('Network.requestWillBeSent')).toBe(0);
        b.commit('L2');
        b.send('L2', [saveFailed('boot-2', b.wallMs())]);
        expect(await w.tick(), 'unknown boot after loss').toBeNull();
        expect(await recordRows(w)).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ unprovenPages: 1 }) })]);
    });

    it('65dd #2: after loss, a KNOWN boot\'s fatal still fails closed', async () => {
        const { b, w } = await setup();
        b.cdp.emit('Inspector.targetCrashed', {});
        b.send('L1', [saveFailed('boot-1', b.wallMs())]);
        expect(await w.tick()).toMatchObject({ kind: 'save_failed' });
    });

    it('65dd #2: unknown page provenance blocks a clean finish even with NO queued event (lost source; untracked page)', async () => {
        const lost = await setup();
        lost.b.cdp.emit('Inspector.detached', { reason: 'test' });
        expect(await recordRows(lost.w)).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ unprovenPages: 1, unattributedRequests: 0 }) })]);
        const untracked = await setup({ track: false });
        expect(await recordRows(untracked.w)).toEqual([expect.objectContaining({ verdict: 'HOLD' })]);
    });

    it('a page that CLOSES normally ends its source without losing provenance', async () => {
        const { b, w } = await setup();
        b.send('L1', [saved('boot-1', b.wallMs())]);
        expect(await w.tick()).toBeNull();
        b.page.closed = true;
        b.cdp.emit('Inspector.detached', { reason: 'target_closed' });
        expect(await recordRows(w)).toEqual([expect.objectContaining({ verdict: 'PASS' })]);
    });

    it('a worker request (empty loader) or a loader with no browser start is never attributed', async () => {
        const worker = await setup();
        worker.b.send('', [step('boot-1', worker.b.wallMs())]);
        expect(await recordRows(worker.w)).toEqual([expect.objectContaining({ verdict: 'HOLD', evidence: expect.objectContaining({ unattributedRequests: 1 }) })]);
        const startless = await setup();
        startless.b.cdp.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'L3' } }); // committed, but no init seen
        startless.b.send('L3', [saveFailed('boot-3', startless.b.wallMs())]);
        expect(await startless.w.tick()).toBeNull();
        expect(await recordRows(startless.w)).toEqual([expect.objectContaining({ verdict: 'HOLD' })]);
    });

    it('a subframe\'s commit or init is not the page\'s document', async () => {
        const { b, w } = await setup();
        b.commit('F1', 'child');
        b.send('L1', [saveFailed('boot-1', b.wallMs())]);
        expect(await w.tick(), 'L1 is still current: not replaced').toMatchObject({ kind: 'save_failed' });
    });

    it('tracking is once per page and applyRwtIdentity is once per page, proven before it resolves', async () => {
        const b = new Browser();
        await trackDocuments(b.page as never, b.cdp as never);
        await trackDocuments(b.page as never, b.cdp as never);
        expect(b.cdp.listenerCount('Network.requestWillBeSent')).toBe(1);
        const c = new Browser();
        const newCDPSession = vi.fn(async () => c.cdp);
        const context = { newCDPSession } as never;
        const identity = { userAgent: 'ua' } as never;
        await Promise.all([applyRwtIdentity(context, c.page as never, identity), applyRwtIdentity(context, c.page as never, identity)]);
        await rwtPageReady(c.page as never);
        expect(newCDPSession).toHaveBeenCalledTimes(1);
        expect(documentTrackerOf(c.page as never).proven).toBe(true);
    });
});

describe('Codex P2 on 06fe109b — telemetry settles before the watchdog verdict is sealed', () => {
    it('Open Mic, Focus and Products wait for their final telemetry BEFORE recording the watchdog row', () => {
        for (const f of ['tests/live/rwt-open-mic-first-session.live.spec.ts', 'tests/live/helpers/rwtFocusPointsJourney.ts', 'tests/live/rwt-products-navigation.live.spec.ts']) {
            const src = readFileSync(f, 'utf8');
            const closure = src.slice(src.indexOf('finalizer.once(async () => {'));
            const wait = closure.indexOf("steps.step('telemetry observed'");
            const record = closure.indexOf("steps.step('watchdog', () => watch.record(receipt))");
            expect({ file: f, waitBeforeRecord: wait > -1 && wait < record }).toEqual({ file: f, waitBeforeRecord: true });
        }
    });

    it('Codex P2 r4313846488: EVERY watchdog verdict in every RWT finalizer comes after a bounded telemetry wait', () => {
        const files = [
            ...readdirSync('tests/live').filter((f) => /^rwt-.*\.live\.spec\.ts$/.test(f)).map((f) => `tests/live/${f}`),
            'tests/live/helpers/rwtFocusPointsJourney.ts',
        ];
        const RECORD = "steps.step('watchdog', () => watch.record(receipt))";
        let records = 0;
        for (const f of files) {
            const src = readFileSync(f, 'utf8');
            for (let at = src.indexOf(RECORD); at !== -1; at = src.indexOf(RECORD, at + 1)) {
                records += 1;
                // The step immediately before the verdict (within its own finalizer) must be a telemetry wait.
                const before = src.slice(src.lastIndexOf('finalizer.once(async () => {', at), at);
                const steps = [...before.matchAll(/steps\.step\('([^']+)'/g)].map((m) => m[1]);
                expect({ file: f, previous: steps[steps.length - 1] }).toEqual({ file: f, previous: expect.stringMatching(/^telemetry (observed|settle)$/) });
            }
        }
        expect(records, 'every finalizer that records a watchdog verdict was checked').toBe(10);
    });

    it('Sam 845401a5 #2: every changed finalizer settles EVERY attached page, not the first flush', () => {
        for (const f of ['rwt-abandon-and-two-tabs', 'rwt-adverse-mic-model', 'rwt-feedback-association-boundaries', 'rwt-save-retry-recovery', 'rwt-pending-start-navigation']) {
            const src = readFileSync(`tests/live/${f}.live.spec.ts`, 'utf8');
            expect({ f, perPage: src.includes("steps.step('telemetry settle', () => tap.settleEveryPage("), anyPage: src.includes("steps.step('telemetry settle', () => tap.settleQueuedTelemetry(") })
                .toEqual({ f, perPage: true, anyPage: false });
        }
    });

    describe('Sam 845401a5 #2: the per-page settle waits for each watched page\'s own flush (deterministic two-page schedule)', () => {
        class Tab extends EventEmitter {
            closed = false;
            readonly frame = {};
            mainFrame() { return this.frame; }
            isClosed() { return this.closed; }
        }
        const posthog = (event: string, props: Record<string, string> = {}) => ({
            url: () => 'https://us.i.posthog.com/e/?ip=1', method: () => 'POST', isNavigationRequest: () => false, frame: () => ({}),
            postDataBuffer: () => Buffer.from(JSON.stringify([{ event, timestamp: new Date().toISOString(), properties: { boot_id: 'b', ...props } }])),
            response: () => Promise.resolve({ status: () => 200 }), failure: () => null,
        });
        /** A fake clock: `wait` advances it and fires each scheduled send once its time comes. */
        const schedule = (sends: { at: number; run: () => void }[]) => {
            let t = 0;
            const due = [...sends].sort((a, b) => a.at - b.at);
            return {
                now: () => t,
                wait: async (ms: number) => { t += ms; while (due.length && due[0].at <= t) due.shift()!.run(); },
            };
        };
        const twoPages = () => {
            const tap = new AnalyticsTap();
            const a = new Tab();
            const b = new Tab();
            tap.attach(b as never);
            tap.attach(a as never);
            return { tap, a, b };
        };
        const fatalOnB = (tap: AnalyticsTap) => tap.events.some((e) => e.event === 'session_save_latency_measured');

        it('A\'s benign flush at +100 ms must not end the wait while B\'s queued fatal arrives at +1.5 s', async () => {
            const { tap, a, b } = twoPages();
            const clock = schedule([
                { at: 100, run: () => a.emit('request', posthog('journey_step')) },
                { at: 1_500, run: () => b.emit('request', posthog('session_save_latency_measured', { outcome: 'failed' })) },
            ]);
            expect(await tap.settleEveryPage(clock.wait, { now: clock.now })).toBe('flushed');
            expect(fatalOnB(tap), 'B\'s fatal is in the tap before the verdict').toBe(true);
            // The inherited any-page settle returns on A's flush, before B's fatal exists (the reviewed gap).
            const again = twoPages();
            const clock2 = schedule([
                { at: 100, run: () => again.a.emit('request', posthog('journey_step')) },
                { at: 1_500, run: () => again.b.emit('request', posthog('session_save_latency_measured', { outcome: 'failed' })) },
            ]);
            expect(await again.tap.settleQueuedTelemetry(clock2.wait, { now: clock2.now })).toBe('flushed');
            expect(fatalOnB(again.tap)).toBe(false);
        });

        it('a closed page is not waited on; a page that never flushes ends at the bound as quiet', async () => {
            const { tap, a, b } = twoPages();
            b.closed = true;
            const clock = schedule([{ at: 100, run: () => a.emit('request', posthog('journey_step')) }]);
            expect(await tap.settleEveryPage(clock.wait, { now: clock.now })).toBe('flushed');
            const silent = twoPages();
            const quiet = schedule([{ at: 100, run: () => silent.a.emit('request', posthog('journey_step')) }]);
            expect(await silent.tap.settleEveryPage(quiet.wait, { now: quiet.now, quietMs: 5_000 })).toBe('quiet');
            expect(quiet.now(), 'bounded').toBeLessThanOrEqual(5_100);
        });
    });

    it('Codex P2 r4314462589: the return retry is strict — the refusal allowance and fault phase end BEFORE the second press', () => {
        const src = readFileSync('tests/live/rwt-abandon-and-two-tabs.live.spec.ts', 'utf8');
        const branch = src.slice(src.indexOf('if (refusalCopyShown) {'), src.indexOf('secondPressRecorded = await isRecording(returned, 60_000);'));
        const click = branch.indexOf("await returned.getByTestId('mic-start').click();");
        expect(branch.indexOf('watch.setStartRefusedAllowed(false);')).toBeGreaterThan(-1);
        expect(branch.indexOf('watch.setStartRefusedAllowed(false);')).toBeLessThan(click);
        expect(branch.indexOf('watch.setFaultPhase(false);')).toBeGreaterThan(-1);
        expect(branch.indexOf('watch.setFaultPhase(false);')).toBeLessThan(click);
    });
});
