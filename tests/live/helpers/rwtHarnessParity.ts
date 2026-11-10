/**
 * Harness-parity checks for the original Playwright journeys (PO route 2026-11-10: the original suites carry the AHT journeys).
 * The cloud-test harness asserts these on every case (its catalog rows `no-cloud-stt`, `start-press-budget`, `owned-pages-closed`
 * and, for AHT-01..03, `probe-save-isolation`); the suites did not. Same definitions as the harness's draft adapters:
 * - no-cloud-stt: no HTTP request AND no WebSocket to the Cloud STT provider (`/assemblyai/i`) from any page of the journey's context;
 * - start-press-budget: Start attempts on every page of the context, counted two independent ways — clicks on the `mic-start`
 *   control, and the recording-lease acquisitions every Start path makes (`rpc/acquire_recording_lease`, which also covers Starts
 *   from other controls such as Practice again) — and judged on the larger count;
 * - probe-save-isolation: after the repeat probes, the account's completed sessions are exactly the journey's saved takes;
 * - owned-pages-closed: every page the context opened closes without error at the end.
 * Rows carry counts and closed reasons only.
 */
import type { BrowserContext, Page } from '@playwright/test';

export const CLOUD_STT_URL = /assemblyai/i;
export const START_CONTROL = '[data-testid="mic-start"]';
export const LEASE_ACQUIRE_URL = /\/rest\/v1\/rpc\/acquire_recording_lease(?:\?|$)/;

interface RowSink { row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>) => void }

export class HarnessParityTap {
    cloudSttRequests = 0;
    cloudSttSockets = 0;
    startClicks = 0;
    leaseAcquisitions = 0;
    private readonly pages = new Set<Page>();

    /** The journey's Start attempts: the larger of the two independent counts. */
    get startPresses(): number { return Math.max(this.startClicks, this.leaseAcquisitions); }

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
        await context.exposeBinding('__rwtStartPress', () => { this.startClicks += 1; });
        await context.addInitScript((selector: string) => {
            document.addEventListener('click', (e) => {
                const t = e.target as Element | null;
                if (t && typeof t.closest === 'function' && t.closest(selector)) {
                    void (window as unknown as { __rwtStartPress?: () => Promise<void> }).__rwtStartPress?.();
                }
            }, true);
        }, START_CONTROL);
    }

    noCloudSttRow(receipt: RowSink): void {
        const ok = this.cloudSttRequests === 0 && this.cloudSttSockets === 0;
        receipt.row('no Cloud speech-to-text request', ok ? 'PASS' : 'FAIL',
            ok ? 'no page of the journey requested or opened a socket to the Cloud STT provider' : 'a page contacted the Cloud STT provider',
            { cloudSttRequests: this.cloudSttRequests, cloudSttSockets: this.cloudSttSockets });
    }

    /** `cap` is the journey's Start-press budget; at least one press is required (a journey that never started proves nothing). */
    startPressRow(receipt: RowSink, cap: number): void {
        const ok = this.startPresses >= 1 && this.startPresses <= cap;
        receipt.row('Start presses within budget', ok ? 'PASS' : 'FAIL',
            ok ? 'every Start press fit the journey\'s budget' : this.startPresses === 0 ? 'no Start press was observed' : 'the journey pressed Start more often than its budget',
            { startPresses: this.startPresses, startClicks: this.startClicks, leaseAcquisitions: this.leaseAcquisitions, cap });
    }

    /** Close every page the context opened; PASS only when all closed without error. Call last, before account cleanup. */
    async ownedPagesClosedRow(receipt: RowSink, closeMs = 15_000): Promise<void> {
        const pages = [...this.pages];
        let failedCloses = 0;
        for (const p of pages) {
            if (p.isClosed()) continue;
            try {
                await Promise.race([p.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), closeMs))]);
            } catch {
                failedCloses += 1;
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
