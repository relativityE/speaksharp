/**
 * Focus Points meaning matcher — main-thread engine (default-off; see `config/focusMeaningMatcher.ts`).
 *
 * Lifecycle (status):
 *   absent       — no consent recorded for the shipped pins; nothing will be fetched.
 *   consented    — consent recorded, model not loaded in this page (it may or may not be in the cache).
 *   downloading  — the worker is acquiring/loading; `pct` is verified bytes over the pinned total. `fromCache`
 *                  says these bytes are being read from the verified cache, not the network.
 *   ready        — the worker has the model in memory; `match()` may use it.
 *   failed       — the last load failed; the user may retry.
 *
 * Who may start what:
 *   - `ensureLoaded()` records consent and may DOWNLOAD. It is called only from the user's explicit opt-in.
 *   - `warmFromCache()` loads a previously consented model from the verified cache and NEVER touches the network
 *     for model files; a cache miss returns the status to `consented`.
 *   - `match()` never loads anything. If the model is not ready it resolves null and the caller keeps the keyword
 *     verdict. The Stop/finalize path therefore cannot start a download.
 *
 * Constructing this class creates no worker and fetches nothing.
 */
import logger from '@/lib/logger';
import type { TalkingPointCoverage, TranscriptSegment } from '@/services/rehearsal/outcomeScorecard';
import { computeMeaningCoverage, type NliScores } from './meaningCoverage';
import { MEANING_MODEL_ID, meaningModelResponsePins, meaningModelScope } from './meaningAssetPins';
import {
    meaningConsentTerms,
    meaningReceiptCovers,
    readMeaningConsent,
    recordMeaningConsent,
} from './meaningModelConsent';
import {
    MEANING_NOT_CACHED,
    type MeaningLoadMode,
    type MeaningWorkerRequest,
    type MeaningWorkerResponse,
} from './meaningWorkerProtocol';
import meaningWorkerUrl from './meaning.worker.ts?worker&url';

export type MeaningMatcherStatus =
    | { kind: 'absent' }
    | { kind: 'consented' }
    | { kind: 'downloading'; pct: number; fromCache: boolean }
    | { kind: 'ready' }
    | { kind: 'failed'; code: string };

/** The minimal Worker surface used here, so tests can supply a fake. */
export interface MeaningWorkerLike {
    postMessage(message: MeaningWorkerRequest): void;
    terminate(): void;
    onmessage: ((event: MessageEvent<MeaningWorkerResponse>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export interface MeaningMatcherDeps {
    createWorker?: () => MeaningWorkerLike;
    store?: Store | null;
    origin?: string;
    now?: () => Date;
}

interface Pending {
    resolve: (response: MeaningWorkerResponse) => void;
    reject: (error: Error) => void;
}

const defaultCreateWorker = (): MeaningWorkerLike =>
    new Worker(meaningWorkerUrl, { type: 'module' }) as unknown as MeaningWorkerLike;

const defaultOrigin = (): string => (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);

export class MeaningMatcher {
    private status: MeaningMatcherStatus;
    private readonly listeners = new Set<() => void>();
    private worker: MeaningWorkerLike | null = null;
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;
    private loading: Promise<void> | null = null;
    private readonly deps: Required<Omit<MeaningMatcherDeps, 'store'>> & { store: Store | null | undefined };

    constructor(deps: MeaningMatcherDeps = {}) {
        this.deps = {
            createWorker: deps.createWorker ?? defaultCreateWorker,
            store: deps.store,
            origin: deps.origin ?? defaultOrigin(),
            now: deps.now ?? (() => new Date()),
        };
        this.status = this.hasConsent() ? { kind: 'consented' } : { kind: 'absent' };
    }

    getStatus(): MeaningMatcherStatus { return this.status; }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    isReady(): boolean { return this.status.kind === 'ready'; }

    private setStatus(next: MeaningMatcherStatus): void {
        this.status = next;
        this.listeners.forEach((l) => l());
    }

    private hasConsent(): boolean {
        const receipt = this.deps.store === undefined ? readMeaningConsent() : readMeaningConsent(this.deps.store);
        return meaningReceiptCovers(receipt, meaningConsentTerms());
    }

    /**
     * The user pressed "Enable". Record consent (read back), then download + load with truthful progress.
     * Rejects — and leaves status `failed` — if consent cannot be persisted or the load fails.
     */
    async ensureLoaded(): Promise<void> {
        if (this.status.kind === 'ready') return;
        if (this.loading) return this.loading;
        try {
            const terms = meaningConsentTerms();
            if (this.deps.store === undefined) recordMeaningConsent(terms, this.deps.now().toISOString());
            else recordMeaningConsent(terms, this.deps.now().toISOString(), this.deps.store);
        } catch (err) {
            this.setStatus({ kind: 'failed', code: 'MEANING_CONSENT_NOT_PERSISTED' });
            throw err;
        }
        return this.load('download');
    }

    /** Make a previously consented model ready from the cache only. Never downloads; never throws. */
    async warmFromCache(): Promise<void> {
        if (this.status.kind === 'ready' || this.loading) return;
        if (!this.hasConsent()) return;
        try {
            await this.load('cache-only');
        } catch {
            // Status already reflects the outcome (consented on a cache miss, failed otherwise).
        }
    }

    private load(mode: MeaningLoadMode): Promise<void> {
        const fromCache = mode === 'cache-only';
        this.setStatus({ kind: 'downloading', pct: 0, fromCache });
        const run = (async () => {
            try {
                const worker = this.ensureWorker();
                const id = this.nextId++;
                await new Promise<void>((resolve, reject) => {
                    this.pending.set(id, {
                        resolve: (response) => {
                            if (response.type === 'progress') {
                                this.setStatus({ kind: 'downloading', pct: response.pct, fromCache });
                                return;
                            }
                            this.pending.delete(id);
                            if (response.type === 'loaded') resolve();
                            else if (response.type === 'error') reject(new Error(response.code));
                            else reject(new Error('MEANING_WORKER_PROTOCOL'));
                        },
                        reject: (error) => { this.pending.delete(id); reject(error); },
                    });
                    worker.postMessage({
                        id,
                        type: 'load',
                        mode,
                        modelId: MEANING_MODEL_ID,
                        pins: meaningModelResponsePins(this.deps.origin),
                        scope: meaningModelScope(this.deps.origin),
                    });
                });
                this.setStatus({ kind: 'ready' });
            } catch (err) {
                const code = err instanceof Error ? err.message : 'MEANING_WORKER_ERROR';
                this.disposeWorker();
                if (mode === 'cache-only' && code === MEANING_NOT_CACHED) this.setStatus({ kind: 'consented' });
                else this.setStatus({ kind: 'failed', code });
                logger.warn({ code, mode }, '[MeaningMatcher] model load did not complete');
                throw err;
            } finally {
                this.loading = null;
            }
        })();
        this.loading = run;
        return run;
    }

    private ensureWorker(): MeaningWorkerLike {
        if (this.worker) return this.worker;
        const worker = this.deps.createWorker();
        worker.onmessage = (event) => {
            if (this.worker !== worker) return;
            this.pending.get(event.data.id)?.resolve(event.data);
        };
        worker.onerror = () => {
            if (this.worker !== worker) return;
            const error = new Error('MEANING_WORKER_ERROR');
            [...this.pending.values()].forEach((p) => p.reject(error));
            this.pending.clear();
            this.disposeWorker();
            if (this.status.kind === 'ready') this.setStatus({ kind: 'failed', code: 'MEANING_WORKER_ERROR' });
        };
        this.worker = worker;
        return worker;
    }

    private disposeWorker(): void {
        const worker = this.worker;
        this.worker = null;
        if (worker) {
            try { worker.terminate(); } catch { /* already gone */ }
        }
    }

    private ask(premise: string, hypothesis: string): Promise<NliScores> {
        const worker = this.worker;
        if (!worker || this.status.kind !== 'ready') return Promise.reject(new Error('MEANING_MODEL_NOT_READY'));
        const id = this.nextId++;
        return new Promise<NliScores>((resolve, reject) => {
            this.pending.set(id, {
                resolve: (response) => {
                    this.pending.delete(id);
                    if (response.type === 'nli-result') resolve({ entail: response.entail, contradict: response.contradict });
                    else reject(new Error(response.type === 'error' ? response.code : 'MEANING_WORKER_PROTOCOL'));
                },
                reject: (error) => { this.pending.delete(id); reject(error); },
            });
            worker.postMessage({ id, type: 'nli', premise, hypothesis });
        });
    }

    /**
     * Meaning-based coverage for each point, or null when it cannot be produced in time (not ready, timeout,
     * error). Never loads or downloads. On timeout no further questions are sent for this run.
     */
    async match(
        points: string[],
        segments: TranscriptSegment[],
        { timeoutMs }: { timeoutMs: number },
    ): Promise<TalkingPointCoverage[] | null> {
        if (!this.isReady()) return null;
        let cancelled = false;
        const nli = (premise: string, hypothesis: string): Promise<NliScores> => (cancelled
            ? Promise.reject(new Error('MEANING_MATCH_CANCELLED'))
            : this.ask(premise, hypothesis));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(() => { cancelled = true; resolve(null); }, timeoutMs);
        });
        try {
            const result = await Promise.race([computeMeaningCoverage(points, segments, nli), timeout]);
            return result;
        } catch (err) {
            logger.warn({ code: err instanceof Error ? err.message : 'unknown' }, '[MeaningMatcher] match failed');
            return null;
        } finally {
            cancelled = true;
            if (timer !== undefined) clearTimeout(timer);
        }
    }
}

let singleton: MeaningMatcher | null = null;

/** The page's matcher, created on first use (the opt-in control). Creating it starts nothing. */
export function getMeaningMatcher(): MeaningMatcher {
    if (!singleton) singleton = new MeaningMatcher();
    return singleton;
}

/** The page's matcher only if something already created it. The Stop path uses this, so it never creates one. */
export function peekMeaningMatcher(): MeaningMatcher | null {
    return singleton;
}

/** Test seam. */
export function resetMeaningMatcherForTests(next: MeaningMatcher | null = null): void {
    singleton = next;
}
