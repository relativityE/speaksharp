/** A scriptable stand-in for `meaning.worker.ts` (tests only). */
import { vi } from 'vitest';
import type { MeaningWorkerLike } from '../MeaningMatcher';
import type { MeaningWorkerRequest, MeaningWorkerResponse } from '../meaningWorkerProtocol';

export interface FakeMeaningWorker extends MeaningWorkerLike {
    sent: MeaningWorkerRequest[];
    emit(response: MeaningWorkerResponse): void;
    last<T extends MeaningWorkerRequest['type']>(type: T): Extract<MeaningWorkerRequest, { type: T }>;
    terminate: ReturnType<typeof vi.fn>;
}

export function createFakeMeaningWorker(): FakeMeaningWorker {
    const worker: FakeMeaningWorker = {
        sent: [],
        onmessage: null,
        onerror: null,
        postMessage(message) { worker.sent.push(message); },
        terminate: vi.fn(),
        emit(response) { worker.onmessage?.({ data: response } as MessageEvent<MeaningWorkerResponse>); },
        last(type) {
            const found = [...worker.sent].reverse().find((m) => m.type === type);
            if (!found) throw new Error(`no ${type} message sent`);
            return found as never;
        },
    };
    return worker;
}

export function memoryStore() {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}
