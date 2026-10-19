// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { BrowserContext, Route } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { holdModelWeight } from '../live/helpers/rwtHeldModelWeight';

const weight = '/models/whisper-base.en/onnx/encoder_model_quantized.onnx';
const deferred = () => {
    let resolve: () => void = () => {};
    let reject: (error: Error) => void = () => {};
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
async function fixture(errorText = 'net::ERR_INTERNET_DISCONNECTED', abortGate?: Promise<void>) {
    const emitter = new EventEmitter();
    let handler: (route: Route) => Promise<void> = async () => {};
    const unroute = vi.fn(async () => {});
    const context = Object.assign(emitter, {
        route: vi.fn(async (_match: unknown, value: (route: Route) => Promise<void>) => { handler = value; }), unroute,
    });
    const request = { failure: () => ({ errorText }) };
    const abort = vi.fn(async () => {
        emitter.emit('requestfailed', request);
        if (abortGate) await abortGate;
    });
    const route = { request: () => request, abort, continue: vi.fn(async () => {}) } as unknown as Route;
    const fault = await holdModelWeight(context as unknown as BrowserContext, 'http://127.0.0.1', weight);
    const handled = handler(route);
    expect(await fault.waitUntilHeld(100)).toBe(true);
    return { fault, handled, abort, unroute, emitter };
}

describe('case14 exact fault reason and joined disposal', () => {
    it('rejects same-Request cancellation instead of qualifying the intended network fault', async () => {
        const { fault, handled } = await fixture('net::ERR_ABORTED');
        try {
            await expect(fault.inject(100)).rejects.toThrow(/wrong_failure/);
            expect(fault.evidence().exercised).toBe(false);
        } finally { await fault.dispose(); await handled; }
    });

    it('does not qualify or resolve injection until route.abort successfully settles', async () => {
        const gate = deferred();
        const { fault, handled, abort } = await fixture(undefined, gate.promise);
        let settled = false;
        const injected = fault.inject(1_000).then((result) => { settled = true; return result; });
        try {
            await vi.waitFor(() => expect(abort).toHaveBeenCalled());
            expect(fault.evidence().exercised).toBe(false);
            expect(settled).toBe(false);
        } finally { gate.resolve(); }
        expect((await injected).exercised).toBe(true);
        await fault.dispose(); await handled;
    });

    it('dispose joins a pending abort and refuses injection as soon as disposal begins', async () => {
        const gate = deferred();
        const { fault, handled, abort } = await fixture(undefined, gate.promise);
        let disposed = false;
        const disposing = fault.dispose().then(() => { disposed = true; });
        try {
            await vi.waitFor(() => expect(abort).toHaveBeenCalled());
            expect(disposed).toBe(false);
            await expect(fault.inject(20)).rejects.toThrow(/disposed/);
        } finally { gate.resolve(); await disposing; await handled; }
        await expect(fault.inject(20)).rejects.toThrow(/disposed/);
    });

    it('a matching failure event cannot qualify an abort command that rejects', async () => {
        const gate = deferred();
        const { fault, handled, abort } = await fixture(undefined, gate.promise);
        const injection = expect(fault.inject(1_000)).rejects.toThrow(/abort_failed/);
        await vi.waitFor(() => expect(abort).toHaveBeenCalled());
        gate.reject(new Error('Target page, context or browser has been closed'));
        await injection;
        expect(fault.evidence().exercised).toBe(false);
        await fault.dispose(); await handled;
    });

    it('closed-context abort/unroute rejection is drained without qualification or a leaked listener', async () => {
        const gate = deferred();
        const { fault, handled, abort, unroute, emitter } = await fixture(undefined, gate.promise);
        unroute.mockRejectedValueOnce(new Error('Target page, context or browser has been closed'));
        const disposing = fault.dispose();
        await vi.waitFor(() => expect(abort).toHaveBeenCalled());
        gate.reject(new Error('Target page, context or browser has been closed'));
        await expect(disposing).resolves.toBeUndefined();
        await expect(handled).resolves.toBeUndefined();
        expect(fault.evidence().exercised).toBe(false);
        expect(emitter.listenerCount('requestfailed')).toBe(0);
    });
});
