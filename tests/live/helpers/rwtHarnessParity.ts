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
export const START_CONTROL = START_CONTROLS.map((id) => `[data-testid="${id}"]`).join(',');
export const LEASE_ACQUIRE_URL = /\/rest\/v1\/rpc\/acquire_recording_lease(?:\?|$)/;

interface RowSink { row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>) => void }

export class HarnessParityTap {
    cloudSttRequests = 0;
    cloudSttSockets = 0;
    readonly startPressesByControl: Record<StartControl, number> = { 'mic-start': 0, 'mic-download': 0, 'mic-retry': 0, 'verdict-practice-again': 0, 'focus-points-retry': 0 };
    leaseAcquisitions = 0;
    private readonly pages = new Set<Page>();

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
        await context.exposeBinding('__rwtStartPress', (_source, id: unknown) => {
            if (typeof id === 'string' && (START_CONTROLS as readonly string[]).includes(id)) this.startPressesByControl[id as StartControl] += 1;
        });
        await context.addInitScript((selector: string) => {
            document.addEventListener('click', (e) => {
                const t = e.target as Element | null;
                const control = t && typeof t.closest === 'function' ? t.closest(selector) : null;
                if (control) void (window as unknown as { __rwtStartPress?: (id: string | null) => Promise<void> }).__rwtStartPress?.(control.getAttribute('data-testid'));
            }, true);
        }, START_CONTROL);
    }

    noCloudSttRow(receipt: RowSink): void {
        const ok = this.cloudSttRequests === 0 && this.cloudSttSockets === 0;
        receipt.row('no Cloud speech-to-text request', ok ? 'PASS' : 'FAIL',
            ok ? 'no page of the journey requested or opened a socket to the Cloud STT provider' : 'a page contacted the Cloud STT provider',
            { cloudSttRequests: this.cloudSttRequests, cloudSttSockets: this.cloudSttSockets });
    }

    /**
     * `cap` is the journey's settled Start-press budget, or null while it is not yet settled from the journey's mapped press total
     * (then HOLD with the counts). At least one press is required: a journey that never started proves nothing.
     */
    startPressRow(receipt: RowSink, cap: number | null): void {
        const evidence = { startPresses: this.startPresses, ...Object.fromEntries(Object.entries(this.startPressesByControl).map(([k, v]) => [`presses:${k}`, v])),
            leaseAcquisitionsDiagnostic: this.leaseAcquisitions, cap };
        if (this.startPresses === 0) { receipt.row('Start presses within budget', 'FAIL', 'no Start press was observed', evidence); return; }
        if (cap === null) { receipt.row('Start presses within budget', 'HOLD', 'the journey\'s Start-press cap is not yet settled; presses counted per control', evidence); return; }
        const ok = this.startPresses <= cap;
        receipt.row('Start presses within budget', ok ? 'PASS' : 'FAIL',
            ok ? 'every Start press fit the journey\'s budget' : 'the journey pressed Start more often than its budget', evidence);
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
 * probe-save-isolation: the account's completed sessions are exactly `expected` (the journey's own saved takes). HOLD when the
 * expected takes are not known or the read fails; FAIL on any other completed session or a missing expected one.
 */
export async function probeSaveIsolationRow(receipt: RowSink, admin: SessionsAdmin, userId: string, expected: Array<string | null | undefined>): Promise<void> {
    const want = expected.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (!userId || want.length !== expected.length) {
        receipt.row('probe saves isolated', 'HOLD', 'the journey\'s saved takes are not all known, so isolation cannot be judged');
        return;
    }
    const { data, error } = await admin.from('sessions').select('id').eq('user_id', userId).eq('status', 'completed');
    if (error || !Array.isArray(data)) {
        receipt.row('probe saves isolated', 'HOLD', 'the completed-session read failed', { readFailed: true });
        return;
    }
    const ids = new Set(data.map((r) => r.id));
    const unexpected = [...ids].filter((id) => !want.includes(id)).length;
    const missing = want.filter((id) => !ids.has(id)).length;
    const ok = unexpected === 0 && missing === 0;
    receipt.row('probe saves isolated', ok ? 'PASS' : 'FAIL',
        ok ? 'the account holds exactly the journey\'s saved takes; the probes saved nothing else'
            : unexpected > 0 ? 'a probe saved a session the journey did not keep' : 'a saved take of the journey is missing',
        { completedSessions: ids.size, expected: want.length, unexpectedCompleted: unexpected, missingExpected: missing });
}
