/**
 * Harness-parity checks for the original Playwright journeys (PO route 2026-11-10: the original suites carry the AHT journeys).
 * The cloud-test harness asserts these on every case (its catalog rows `no-cloud-stt`, `start-press-budget`, `owned-pages-closed`
 * and, for AHT-01..03, `probe-save-isolation`); the suites did not. Same definitions as the harness's draft adapters:
 * - no-cloud-stt: no HTTP request AND no WebSocket to the Cloud STT provider (`/assemblyai/i`) from any page of the journey's context;
 * - start-press-budget: presses of the harness's Start controls (START_CONTROLS: mic-start, mic-download, mic-retry,
 *   verdict-practice-again, focus-points-retry), counted directly at the DOM click on every page, per control. Recording-lease
 *   acquisitions are reported as a separate diagnostic only: a lease is not a press (Retry setup and pre-lease refusals acquire
 *   none). Until a journey's cap is settled from its mapped press total, the row is HOLD with the counts;
 * - probe-save-isolation: after the repeat probes, the account's completed sessions are exactly the journey's saved takes;
 * - owned-pages-closed: every page the context opened closes without error at the end.
 * Rows carry counts and closed reasons only.
 */
import type { BrowserContext, Page } from '@playwright/test';

export const CLOUD_STT_URL = /assemblyai/i;
/** The cloud-test harness's Start controls (draft-adapters/browser-actions.cjs START_CONTROLS), exactly. */
export const START_CONTROLS = Object.freeze(['mic-start', 'mic-download', 'mic-retry', 'verdict-practice-again', 'focus-points-retry'] as const);
export type StartControl = typeof START_CONTROLS[number];
/** Per take (one per Start press, in press order): its control and the saved ids written in its own interval; plus stray saves. */
export interface TakeBindings { takes: Array<{ control: StartControl; ids: string[] }>; stray: string[] }
/** A journey's designed Start presses: the total, and the most each control may be pressed (an unlisted control allows none). */
export interface StartPressBudget { total: number; perControl: Partial<Record<StartControl, number>> }
export const START_CONTROL = START_CONTROLS.map((id) => `[data-testid="${id}"]`).join(',');
export const LEASE_ACQUIRE_URL = /\/rest\/v1\/rpc\/acquire_recording_lease(?:\?|$)/;

interface RowSink { row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>) => void }

export class HarnessParityTap {
    cloudSttRequests = 0;
    cloudSttSockets = 0;
    readonly startPressesByControl: Record<StartControl, number> = { 'mic-start': 0, 'mic-download': 0, 'mic-retry': 0, 'verdict-practice-again': 0, 'focus-points-retry': 0 };
    leaseAcquisitions = 0;
    /** Start presses and persisted-id writes, each with its document and that document's own sequence number. */
    private readonly pressEvents: Array<{ doc: string; seq: number; control: StartControl }> = [];
    private readonly persistEvents: Array<{ doc: string; seq: number; id: string }> = [];
    private readonly pages = new Set<Page>();

    /**
     * Each Start press is a take; its saved session is the persisted-id write in the SAME document after that press and before the
     * next press there. A write with no earlier press in its document is a stray save. Computed when read, so the order in which
     * the two bindings' calls arrive cannot change an attribution.
     */
    takeBindings(): TakeBindings {
        const takes = this.pressEvents.map((p) => ({ control: p.control, doc: p.doc, seq: p.seq, ids: [] as string[] }));
        const stray: string[] = [];
        for (const w of this.persistEvents) {
            let owner: (typeof takes)[number] | null = null;
            for (const t of takes) if (t.doc === w.doc && t.seq < w.seq && (!owner || t.seq > owner.seq)) owner = t;
            if (!owner) { if (!stray.includes(w.id)) stray.push(w.id); continue; }
            if (!owner.ids.includes(w.id)) owner.ids.push(w.id);
        }
        return { takes: takes.map(({ control, ids }) => ({ control, ids })), stray };
    }

    /** Presses of the harness's Start controls, counted directly. */
    get startPresses(): number { return Object.values(this.startPressesByControl).reduce((a, b) => a + b, 0); }

    private track(p: Page): void {
        if (this.pages.has(p)) return;
        this.pages.add(p);
        p.on('websocket', (ws) => { if (CLOUD_STT_URL.test(ws.url())) this.cloudSttSockets += 1; });
    }

    /** Attach BEFORE the first navigation: the click recorder is an init script, so it covers every later document. */
    async attach(context: BrowserContext): Promise<void> {
        for (const p of context.pages()) this.track(p);
        context.on('page', (p) => this.track(p));
        context.on('request', (r) => {
            if (CLOUD_STT_URL.test(r.url())) this.cloudSttRequests += 1;
            if (r.method() === 'POST' && LEASE_ACQUIRE_URL.test(r.url())) this.leaseAcquisitions += 1;
        });
        const pressed = (_source: unknown, id: unknown, doc: unknown, seq: unknown) => {
            if (typeof id !== 'string' || !(START_CONTROLS as readonly string[]).includes(id) || typeof doc !== 'string' || !Number.isInteger(seq)) return;
            this.startPressesByControl[id as StartControl] += 1;
            this.pressEvents.push({ doc, seq: seq as number, control: id as StartControl });
        };
        const persisted = (_source: unknown, id: unknown, doc: unknown, seq: unknown) => {
            if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || typeof doc !== 'string' || !Number.isInteger(seq)) return;
            this.persistEvents.push({ doc, seq: seq as number, id });
        };
        await context.exposeBinding('__rwtStartPress', pressed);
        await context.exposeBinding('__rwtPersisted', persisted);
        // ONE script per document: its id and sequence order both events. It touches no document node while installing (safe before
        // the parser creates a root). A persisted id is captured at the product's own write (setAttribute on the root, always after
        // `data-session-persisted="true"`), so a set-then-clear in one turn is never lost; the original write runs first and unchanged.
        await context.addInitScript((selector: string) => {
            const w = window as unknown as { __rwtStartPress?: (...a: unknown[]) => Promise<void>; __rwtPersisted?: (...a: unknown[]) => Promise<void> };
            const doc = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            let seq = 0;
            document.addEventListener('click', (e) => {
                const t = e.target as Element | null;
                const control = t && typeof t.closest === 'function' ? t.closest(selector) : null;
                if (control) void w.__rwtStartPress?.(control.getAttribute('data-testid'), doc, ++seq);
            }, true);
            const original = Element.prototype.setAttribute;
            Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
                original.call(this, name, value);
                if (name === 'data-session-persisted-id' && this === document.documentElement) void w.__rwtPersisted?.(String(value), doc, ++seq);
            };
        }, START_CONTROL);
    }

    noCloudSttRow(receipt: RowSink): void {
        const ok = this.cloudSttRequests === 0 && this.cloudSttSockets === 0;
        receipt.row('no Cloud speech-to-text request', ok ? 'PASS' : 'FAIL',
            ok ? 'no page of the journey requested or opened a socket to the Cloud STT provider' : 'a page contacted the Cloud STT provider',
            { cloudSttRequests: this.cloudSttRequests, cloudSttSockets: this.cloudSttSockets });
    }

    /**
     * `budget` is the journey's DESIGNED Start presses: a total and a maximum per control (a control not listed allows none), or
     * null while not yet settled (HOLD with the counts). At least one press is required: a journey that never started proves nothing.
     */
    startPressRow(receipt: RowSink, budget: StartPressBudget | null): void {
        const evidence = { startPresses: this.startPresses, ...Object.fromEntries(Object.entries(this.startPressesByControl).map(([k, v]) => [`presses:${k}`, v])),
            leaseAcquisitionsDiagnostic: this.leaseAcquisitions, cap: budget ? budget.total : null };
        if (this.startPresses === 0) { receipt.row('Start presses within budget', 'FAIL', 'no Start press was observed', evidence); return; }
        if (budget === null) { receipt.row('Start presses within budget', 'HOLD', 'the journey\'s Start-press cap is not yet settled; presses counted per control', evidence); return; }
        const over = START_CONTROLS.filter((c) => this.startPressesByControl[c] > (budget.perControl[c] ?? 0));
        const ok = this.startPresses <= budget.total && over.length === 0;
        receipt.row('Start presses within budget', ok ? 'PASS' : 'FAIL',
            ok ? 'every Start press fit the journey\'s designed budget' : this.startPresses > budget.total ? 'the journey pressed Start more often than designed'
                : 'a Start control was pressed more often than the journey is designed to press it', { ...evidence, overControls: over.join(',') || null });
    }

    /** Close every page the context opened; PASS only when all closed without error. Call last, before account cleanup. */
    async ownedPagesClosedRow(receipt: RowSink, closeMs = 15_000): Promise<void> {
        const pages = [...this.pages];
        let failedCloses = 0;
        for (const p of pages) {
            if (p.isClosed()) continue;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([p.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('close timeout')), closeMs); })]);
            } catch {
                failedCloses += 1;
            } finally {
                if (timer) clearTimeout(timer);
            }
        }
        const closed = pages.filter((p) => p.isClosed()).length;
        const ok = failedCloses === 0 && closed === pages.length;
        receipt.row('owned pages closed', ok ? 'PASS' : 'FAIL', ok ? 'every page the journey opened closed' : 'a page the journey opened did not close',
            { ownedPages: pages.length, closedPages: closed, failedCloses });
    }
}

type SessionsAdmin = {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => Promise<{ data: Array<{ id: string }> | null; error: { code?: string } | null }> } } };
};

/**
 * probe-save-isolation, for the original journeys (review RETURNs on 5e1fa2fd and 2611cce9): every designed take is bound to ITS
 * saved session — the persisted id written in the take's own document after its Start press and before the next press there
 * (HarnessParityTap.takeBindings). `capturedTakes` are the ids the journey captured itself (first take, Practice-again take).
 * PASS: exactly `designedTakes` takes, each bound to exactly one id, the ids distinct, the captured ones on their takes, no stray
 *   save, and the account's completed sessions EXACTLY the bound set.
 * HOLD: fewer takes than designed, a take with no bound save (missing) or with two (ambiguous — a second save never stands in
 *   for a missing take), a captured take unknown, or a failed read.
 * FAIL: a stray save no take started, more takes than designed, one id bound to two takes, a captured take on the wrong take, a
 *   completed session bound to no take, or a bound take not completed.
 */
export async function probeSaveIsolationRow(receipt: RowSink, admin: SessionsAdmin, userId: string, capturedTakes: Array<string | null | undefined>,
    bindings: TakeBindings, designedTakes: number): Promise<void> {
    const captured = capturedTakes.filter((x): x is string => typeof x === 'string' && x.length > 0);
    const missing = bindings.takes.filter((t) => t.ids.length === 0).length;
    const ambiguous = bindings.takes.filter((t) => t.ids.length > 1).length;
    const base = { designedTakes, takes: bindings.takes.length, missingBindings: missing, ambiguousBindings: ambiguous, straySaves: bindings.stray.length,
        capturedTakes: captured.length };
    const row = (v: 'PASS' | 'FAIL' | 'HOLD', d: string, e: Record<string, string | number | boolean | null> = {}) => receipt.row('probe saves isolated', v, d, { ...base, ...e });
    if (!userId || captured.length !== capturedTakes.length || !Number.isInteger(designedTakes) || designedTakes < captured.length) {
        return row('HOLD', 'a captured take of the journey is unknown, so isolation cannot be judged');
    }
    if (bindings.stray.length > 0) return row('FAIL', 'a session was saved that no Start press began (a stray save)');
    if (bindings.takes.length > designedTakes) return row('FAIL', 'the journey started more takes than designed');
    if (bindings.takes.length < designedTakes) return row('HOLD', 'fewer takes were started than designed, so isolation cannot be judged');
    if (missing > 0 || ambiguous > 0) {
        return row('HOLD', missing > 0 ? 'a take has no saved session bound to it' : 'a take has more than one saved session (ambiguous); none stands in for another');
    }
    const bound = bindings.takes.map((t) => t.ids[0]);
    if (new Set(bound).size !== bound.length) return row('FAIL', 'one saved session is bound to two takes');
    if (captured.some((id, k) => bound[k] !== id)) return row('FAIL', 'a captured take\'s session is not the session bound to that take');
    const { data, error } = await admin.from('sessions').select('id').eq('user_id', userId).eq('status', 'completed');
    if (error || !Array.isArray(data)) return row('HOLD', 'the completed-session read failed', { readFailed: true });
    const completed = new Set(data.map((r) => r.id));
    const unattributed = [...completed].filter((id) => !bound.includes(id)).length;
    const notCompleted = bound.filter((id) => !completed.has(id)).length;
    const ok = unattributed === 0 && notCompleted === 0;
    return row(ok ? 'PASS' : 'FAIL', ok ? 'every designed take saved exactly one bound session, and nothing else saved'
        : unattributed > 0 ? 'a completed session is bound to no take (a double or stray save)' : 'a take\'s bound session is not completed',
    { completedSessions: completed.size, unattributed, notCompleted });
}

/**
 * same-target-numeric (catalog AHT-01..03): the harness's OWN check (tools/cloud-test/harness/draft-adapters/progress-numeric.cjs),
 * not a copy — it reads the persisted recommendation, the linked repeat attempt and both evaluations, and compares the rendered
 * `progress-attempt-values` text with the exact formatted before → after values. Its result maps PASS/FAIL/NOT RUN to
 * PASS/FAIL/HOLD; only its closed reason code and booleans reach the row.
 */
export type NumericResult = { result: 'PASS' | 'FAIL' | 'NOT RUN'; facts?: Record<string, unknown> };
export function numericComparisonRow(receipt: RowSink, r: NumericResult | null): void {
    const facts = r?.facts ?? {};
    const reason = typeof facts.reason === 'string' && /^[a-z0-9-]{1,80}$/.test(facts.reason) ? facts.reason : 'unknown';
    const evidence: Record<string, string | number | boolean | null> = { reason };
    for (const [k, v] of Object.entries(facts)) if (k !== 'reason' && typeof v === 'boolean') evidence[k] = v;
    if (!r) { receipt.row('saved and displayed comparison numbers match', 'HOLD', 'the numeric comparison could not be observed', { reason: 'not-observed' }); return; }
    const verdict = r.result === 'PASS' ? 'PASS' : r.result === 'FAIL' ? 'FAIL' : 'HOLD';
    receipt.row('saved and displayed comparison numbers match', verdict,
        verdict === 'PASS' ? 'the displayed before → after values equal the saved values exactly (metric, order, units, precision)'
            : verdict === 'FAIL' ? 'the displayed comparison does not match the saved values' : 'the numeric comparison was not established', evidence);
}
