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
    let signalFailed: () => void = () => {};
    const failedGate = new Promise<void>((resolve) => { signalFailed = resolve; });
    const onFailed = (observed: Request) => {
        if (injected && observed === request) {
            failed = true;
            errorText = observed.failure()?.errorText ?? null;
            signalFailed();
        }
    };
    const handler = async (route: Route) => {
        if (held) { await route.continue(); return; }
        held = route;
        request = route.request();
        signalHeld();
        await releaseGate;
        await route.abort(injected ? 'internetdisconnected' : 'aborted');
    };
    context.on('requestfailed', onFailed);
    await context.route(match, handler);
    const bounded = async (promise: Promise<void>, timeoutMs: number) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([promise.then(() => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
        } finally { if (timer) clearTimeout(timer); }
    };
    const evidence = () => ({ matched: request !== null, injected, failed, errorText, exercised: injected && failed });
    return {
        waitUntilHeld: (timeoutMs = 2_000) => bounded(heldGate, timeoutMs),
        evidence,
        inject: async (timeoutMs = 2_000) => {
            if (!held) throw new Error('model_fault_not_exercised: no held weight request');
            injected = true;
            release();
            if (!await bounded(failedGate, timeoutMs)) throw new Error('model_fault_unobserved: held request failure missing');
            return evidence();
        },
        dispose: async () => {
            release();
            context.off('requestfailed', onFailed);
            await context.unroute(match, handler);
        },
    };
}
