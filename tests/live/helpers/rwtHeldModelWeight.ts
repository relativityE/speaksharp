import type { BrowserContext, Request, Route } from '@playwright/test';

/** Hold one exact weight request. Only that Request's failure can exercise the fault. */
export async function holdModelWeight(context: BrowserContext, origin: string, pathname: string) {
    if (!/^\/models\/.+\/onnx\/[^/]+\.onnx$/.test(pathname)) throw new Error('expected an exact model-weight path');
    const match = (url: URL) => url.origin === origin && url.pathname === pathname;
    let held: Route | null = null;
    let request: Request | null = null;
    let release: () => void = () => {};
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    let signalHeld: () => void = () => {};
    const heldGate = new Promise<void>((resolve) => { signalHeld = resolve; });
    let injected = false;
    let failed = false;
    let errorText: string | null = null;
    let disposed = false;
    let abortSucceeded = false;
    let abortFailure: unknown = null;
    let heldTask: Promise<void> | null = null;
    let disposal: Promise<void> | null = null;
    const handlers = new Set<Promise<void>>();
    const contextClosed = (error: unknown) => error instanceof Error && /(?:target|page|context|browser).*closed/i.test(error.message);
    let signalFailed: () => void = () => {};
    const failedGate = new Promise<void>((resolve) => { signalFailed = resolve; });
    const onFailed = (observed: Request) => {
        if (injected && observed === request) {
            failed = true;
            errorText = observed.failure()?.errorText ?? null;
            signalFailed();
        }
    };
    const handler = (route: Route) => {
        const primary = !held && !disposed;
        if (primary) {
            held = route;
            request = route.request();
            signalHeld();
        }
        const task = (async () => {
            if (!primary) {
                try { if (disposed) await route.abort('aborted'); else await route.continue(); }
                catch (error) { if (!contextClosed(error)) abortFailure = error; }
                return;
            }
            await releaseGate;
            try {
                await route.abort(injected ? 'internetdisconnected' : 'aborted');
                abortSucceeded = true;
            } catch (error) { abortFailure = error; }
        })();
        if (primary) heldTask = task;
        handlers.add(task);
        void task.then(() => { handlers.delete(task); });
        return task;
    };
    context.on('requestfailed', onFailed);
    await context.route(match, handler);
    const bounded = async (promise: Promise<void>, timeoutMs: number) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([promise.then(() => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
        } finally { if (timer) clearTimeout(timer); }
    };
    const evidence = () => ({ matched: request !== null, injected, failed, errorText,
        exercised: injected && abortSucceeded && failed && errorText === 'net::ERR_INTERNET_DISCONNECTED' });
    return {
        waitUntilHeld: (timeoutMs = 2_000) => bounded(heldGate, timeoutMs),
        evidence,
        inject: async (timeoutMs = 2_000) => {
            if (disposed) throw new Error('model_fault_disposed');
            if (!held) throw new Error('model_fault_not_exercised: no held weight request');
            if (injected) throw new Error('model_fault_already_injected');
            injected = true;
            release();
            const settled = await bounded((async () => {
                await heldTask;
                if (!abortSucceeded) throw new Error('model_fault_abort_failed');
                await failedGate;
            })(), timeoutMs);
            if (disposed) throw new Error('model_fault_disposed');
            if (!settled) throw new Error('model_fault_unobserved: held request failure missing');
            if (errorText !== 'net::ERR_INTERNET_DISCONNECTED') throw new Error('model_fault_wrong_failure');
            return evidence();
        },
        dispose: () => {
            if (disposal) return disposal;
            disposed = true;
            release();
            disposal = (async () => {
                let unrouteFailure: unknown = null;
                try { await context.unroute(match, handler); }
                catch (error) { unrouteFailure = error; }
                finally {
                    await Promise.all([...handlers]);
                    context.off('requestfailed', onFailed);
                }
                if (unrouteFailure && !contextClosed(unrouteFailure)) throw new Error('model_fault_disposal_unroute_failed');
                if (abortFailure && !contextClosed(abortFailure)) throw new Error('model_fault_disposal_abort_failed');
            })();
            return disposal;
        },
    };
}
