// @vitest-environment node
/**
 * #1593 (PO 2026-10-18) — the fail-early watchdog. Live case 12 (run 39167876945, journey telemetry 0dd69eaf) waited blind
 * for 30 minutes and timed out before its cleanup: a denied microphone reached RECORDING at once, the take's save ended
 * `session_completion_failed`, and Start never re-enabled. Each of those is a closed signal the tap already decodes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOM_READ_TIMEOUT_MS, JourneyFinalizer, JourneyWatchdog, STALL_MS, WATCHED_FIELDS, fatalSignalOf, stallOf, type DomState, type WatchProfile } from '../live/helpers/rwtWatchdog';

const ev = (event: string, watch: Record<string, string> = {}) => ({ event, watch, at: Date.now() });
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
        expect(stallOf(dom({ runtimeState: 'IDLE', modelStatus: 'loading', controlEnabled: false }), 10 * STALL_MS.START_DEAD)).toBeNull();
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
        h.tap.events.push({ event: 'recording_state', at: Date.now(), watch: { from_state: 'STOPPING', to_state: 'FAILED', failure_code: 'session_completion_failed' } });
        const s = await w.tick();
        expect(s).toMatchObject({ kind: 'recording_failed', event: 'recording_state', fields: { failure_code: 'session_completion_failed' } });
        expect(h.closed.sort()).toEqual(['deviceB', 'main']);
        expect(h.logs.some((l) => l.startsWith('RWT_FAIL_EARLY '))).toBe(true);
        w.record(h.receipt as never);
        expect(h.rows).toEqual([expect.objectContaining({ step: 'fail-early watchdog', verdict: 'FAIL' })]);
        // Tripped once: a later tick does not re-trip or close again.
        await w.tick();
        expect(h.closed).toHaveLength(2);
    });

    it('Codex P2 r4309303716: after the DOM view moves to another page, a trip still closes the starting context', async () => {
        const h = harness({ runtimeState: 'RECORDING', modelStatus: 'ready', control: null, controlEnabled: null });
        const w = new JourneyWatchdog({ page: h.page as never, tap: h.tap as never, profile: {}, label: 'case', log: () => undefined });
        w.setPage({ context: () => h.ctx('deviceB'), evaluate: async () => null } as never);
        h.tap.events.push({ event: 'session_save_latency_measured', at: Date.now(), watch: { outcome: 'failed' } });
        await w.tick();
        expect(h.closed.sort()).toEqual(['deviceB', 'main']);
    });

    it('Codex P2 r4309303711: a phase can withdraw the suite\'s refusal allowance, so a second refusal trips', async () => {
        const h = harness(null);
        const w = new JourneyWatchdog({ page: h.page as never, tap: h.tap as never, profile: { allowStartRefused: true }, label: 'case', log: () => undefined });
        w.setFaultPhase(true);
        h.tap.events.push({ event: 'session_start_latency_measured', at: Date.now(), watch: { outcome: 'refused' } });
        expect(await w.tick(), 'the expected first refusal').toBeNull();
        w.setStartRefusedAllowed(false);
        h.tap.events.push({ event: 'recording_intent', at: Date.now(), watch: { intent_kind: 'start', intent_outcome: 'blocked_lock_held' } });
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
        h.tap.events.push({ event: 'session_save_latency_measured', at: Date.now(), watch: { outcome: 'saved' } });
        expect(await w.tick()).toBeNull();
        const beat = w.heartbeat();
        expect(beat.startsWith('RWT_HEARTBEAT ')).toBe(true);
        expect(JSON.parse(beat.slice('RWT_HEARTBEAT '.length))).toMatchObject({ runtimeState: 'READY', control: 'mic-start', lastEvent: 'session_save_latency_measured', tripped: null });
        w.record(h.receipt as never);
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

    it('a spec that deletes its run-owned account in the test body also has the afterEach backstop (live case 12)', () => {
        for (const f of readdirSync('tests/live').filter((n) => /^rwt-.*\.live\.spec\.ts$/.test(n))) {
            const src = read(`tests/live/${f}`);
            if (!src.includes('cleanupRunOwnedAccount(')) continue;
            expect(/test\.afterEach\(/.test(src), `${f} has an afterEach cleanup`).toBe(true);
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
        h.tap.events.push({ event: 'session_save_latency_measured', at: Date.now(), releaseSha: 'b'.repeat(40), watch: { outcome: 'failed' } });
        h.tap.events.push({ event: 'session_save_latency_measured', at: 0, capturedAt: 0, watch: { outcome: 'failed' } });
        expect(await w.tick()).toBeNull();
        expect(h.closed).toEqual([]);
        h.tap.events.push({ event: 'session_save_latency_measured', at: Date.now(), releaseSha: 'a'.repeat(40), watch: { outcome: 'failed' } });
        expect(await w.tick(), 'this run\'s own failure still trips').toMatchObject({ kind: 'save_failed' });
    });

    it('control 3: an injected fault is excused only inside its phase — a later take\'s failure trips', async () => {
        const h = fakes(async () => null);
        const w = new JourneyWatchdog({ ...quiet, page: h.page as never, tap: h.tap as never, profile: { allowSaveFailed: true } });
        w.setFaultPhase(true);
        h.tap.events.push({ event: 'session_save_latency_measured', at: Date.now(), watch: { outcome: 'failed' } });
        expect(await w.tick(), 'the injected failure').toBeNull();
        w.setFaultPhase(false);
        h.tap.events.push({ event: 'session_save_latency_measured', at: Date.now(), watch: { outcome: 'failed' } });
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
        h.tap.events.push({ event: 'recording_state', at: Date.now(), watch: { to_state: 'FAILED', failure_code: 'engine_error' } });
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
