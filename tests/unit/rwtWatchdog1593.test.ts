// @vitest-environment node
/**
 * #1593 (PO 2026-10-18) — the fail-early watchdog. Live case 12 (run 39167876945, journey telemetry 0dd69eaf) waited blind
 * for 30 minutes and timed out before its cleanup: a denied microphone reached RECORDING at once, the take's save ended
 * `session_completion_failed`, and Start never re-enabled. Each of those is a closed signal the tap already decodes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JourneyWatchdog, STALL_MS, WATCHED_FIELDS, fatalSignalOf, stallOf, type DomState, type WatchProfile } from '../live/helpers/rwtWatchdog';

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
        const page = { context: () => ctx('main'), evaluate: async () => domState };
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
