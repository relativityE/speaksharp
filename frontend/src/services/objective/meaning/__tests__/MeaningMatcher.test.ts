import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeaningMatcher, peekMeaningMatcher, getMeaningMatcher, resetMeaningMatcherForTests } from '../MeaningMatcher';
import { MEANING_CONSENT_STORAGE_KEY, meaningConsentTerms, recordMeaningConsent } from '../meaningModelConsent';
import { MEANING_NOT_CACHED } from '../meaningWorkerProtocol';
import { createFakeMeaningWorker, memoryStore, type FakeMeaningWorker } from './fakeMeaningWorker';

const flush = () => new Promise((r) => setTimeout(r, 0));

async function readyMatcher(): Promise<{ matcher: MeaningMatcher; worker: FakeMeaningWorker }> {
    const worker = createFakeMeaningWorker();
    const matcher = new MeaningMatcher({ createWorker: () => worker, store: memoryStore(), origin: 'https://app.test' });
    const loading = matcher.ensureLoaded();
    worker.emit({ id: worker.last('load').id, type: 'loaded', loadTimeMs: 1 });
    await loading;
    return { matcher, worker };
}

describe('MeaningMatcher', () => {
    afterEach(() => { resetMeaningMatcherForTests(null); vi.useRealTimers(); });

    it('constructing it creates no worker; the Stop path peeks and never creates one', () => {
        const createWorker = vi.fn();
        const m = new MeaningMatcher({ createWorker, store: memoryStore() });
        expect(createWorker).not.toHaveBeenCalled();
        expect(m.getStatus()).toEqual({ kind: 'absent' });
        expect(peekMeaningMatcher()).toBeNull();
        const created = getMeaningMatcher();
        expect(peekMeaningMatcher()).toBe(created);
    });

    it('match() when not ready resolves null without creating a worker', async () => {
        const createWorker = vi.fn();
        const m = new MeaningMatcher({ createWorker, store: memoryStore() });
        expect(await m.match(['Launch in June'], [{ text: 'We launch in June.', startSec: 1 }], { timeoutMs: 3000 })).toBeNull();
        expect(createWorker).not.toHaveBeenCalled();
    });

    it('ensureLoaded records consent, asks the worker to DOWNLOAD the pinned files, and reports progress then ready', async () => {
        const worker = createFakeMeaningWorker();
        const store = memoryStore();
        const m = new MeaningMatcher({ createWorker: () => worker, store, origin: 'https://app.test' });
        const loading = m.ensureLoaded();
        expect(store.data.has(MEANING_CONSENT_STORAGE_KEY)).toBe(true);
        const load = worker.last('load');
        expect(load).toMatchObject({ mode: 'download', modelId: 'nli-deberta-v3-xsmall', scope: 'https://app.test/models/nli-deberta-v3-xsmall/' });
        expect(load.pins.length).toBeGreaterThan(0);
        worker.emit({ id: load.id, type: 'progress', pct: 37 });
        expect(m.getStatus()).toEqual({ kind: 'downloading', pct: 37, fromCache: false });
        worker.emit({ id: load.id, type: 'loaded', loadTimeMs: 5 });
        await loading;
        expect(m.isReady()).toBe(true);
    });

    it('warmFromCache uses cache-only and returns to consented on a cache miss (never downloads)', async () => {
        const worker = createFakeMeaningWorker();
        const store = memoryStore();
        recordMeaningConsent(meaningConsentTerms(), 'earlier', store);
        const m = new MeaningMatcher({ createWorker: () => worker, store });
        expect(m.getStatus()).toEqual({ kind: 'consented' });
        const warming = m.warmFromCache();
        expect(worker.sent.filter((x) => x.type === 'load').map((x) => (x as { mode: string }).mode)).toEqual(['cache-only']);
        worker.emit({ id: worker.last('load').id, type: 'error', code: MEANING_NOT_CACHED });
        await warming;
        expect(m.getStatus()).toEqual({ kind: 'consented' });
        expect(worker.sent.some((x) => x.type === 'load' && x.mode === 'download')).toBe(false);
    });

    it('warmFromCache without consent does nothing', async () => {
        const createWorker = vi.fn();
        const m = new MeaningMatcher({ createWorker, store: memoryStore() });
        await m.warmFromCache();
        expect(createWorker).not.toHaveBeenCalled();
    });

    it('a failed load is reported as failed and can be retried', async () => {
        const workers: FakeMeaningWorker[] = [];
        const m = new MeaningMatcher({ createWorker: () => { const w = createFakeMeaningWorker(); workers.push(w); return w; }, store: memoryStore() });
        const first = m.ensureLoaded();
        workers[0].emit({ id: workers[0].last('load').id, type: 'error', code: 'MEANING_MODEL_INTEGRITY_FAILED' });
        await expect(first).rejects.toThrow('MEANING_MODEL_INTEGRITY_FAILED');
        expect(m.getStatus()).toEqual({ kind: 'failed', code: 'MEANING_MODEL_INTEGRITY_FAILED' });
        expect(workers[0].terminate).toHaveBeenCalled();
        const retry = m.ensureLoaded();
        workers[1].emit({ id: workers[1].last('load').id, type: 'loaded', loadTimeMs: 1 });
        await retry;
        expect(m.isReady()).toBe(true);
    });

    it('consent that cannot be persisted fails the opt-in and starts no download', async () => {
        const createWorker = vi.fn();
        const m = new MeaningMatcher({ createWorker, store: { getItem: () => null, setItem: () => undefined } });
        await expect(m.ensureLoaded()).rejects.toThrow(/MEANING_CONSENT_NOT_PERSISTED/);
        expect(createWorker).not.toHaveBeenCalled();
        expect(m.getStatus()).toEqual({ kind: 'failed', code: 'MEANING_CONSENT_NOT_PERSISTED' });
    });

    it('match() answers through the worker and returns attributed coverage', async () => {
        const { matcher, worker } = await readyMatcher();
        const result = matcher.match(['Launch in June'], [{ text: 'We launch in June.', startSec: 4 }], { timeoutMs: 3000 });
        // Answer every NLI question the rules ask, in order.
        for (let i = 0; i < 20; i++) {
            await flush();
            const pending = worker.sent.filter((m) => m.type === 'nli').slice(i, i + 1)[0];
            if (!pending) break;
            worker.emit({ id: pending.id, type: 'nli-result', entail: 0.9, contradict: 0.01 });
        }
        expect(await result).toEqual([{
            point: 'Launch in June', status: 'covered', matchRatio: 1, evidence: { quote: 'We launch in June.', timestampSec: 4 },
        }]);
    });

    it('match() resolves null on timeout and asks no further questions', async () => {
        const { matcher, worker } = await readyMatcher();
        vi.useFakeTimers();
        const result = matcher.match(['Launch in June'], [{ text: 'We launch in June.', startSec: 4 }, { text: 'Thanks.', startSec: 9 }], { timeoutMs: 3000 });
        await vi.advanceTimersByTimeAsync(3001);
        expect(await result).toBeNull();
        const asked = worker.sent.filter((m) => m.type === 'nli').length;
        // Answer the in-flight question late: the cancelled run must not send another.
        const inflight = worker.sent.filter((m) => m.type === 'nli').pop();
        if (inflight) worker.emit({ id: inflight.id, type: 'nli-result', entail: 0.1, contradict: 0.1 });
        await vi.advanceTimersByTimeAsync(10);
        expect(worker.sent.filter((m) => m.type === 'nli').length).toBe(asked);
    });

    it('match() resolves null when the worker reports an error', async () => {
        const { matcher, worker } = await readyMatcher();
        const result = matcher.match(['Launch in June'], [{ text: 'We launch in June.', startSec: 4 }], { timeoutMs: 3000 });
        await flush();
        worker.emit({ id: worker.last('nli').id, type: 'error', code: 'MEANING_WORKER_ERROR' });
        expect(await result).toBeNull();
    });
});
