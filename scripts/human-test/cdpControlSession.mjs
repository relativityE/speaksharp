/**
 * RWT-01 — the pre-take control's own debugger connections, shared by `prepare-take.mjs` and its real-socket casualty.
 *
 * A page client is ITSELF an attachment: Chromium reports `TargetInfo.attached: true` for a page while any client holds
 * it. So exclusivity is read from the browser endpoint, and the page client is opened only after that read is clean
 * (PM RETURN 5664428448). Every reply is bounded: an unanswered command must never leave the control, or the page, waiting.
 */
import { WebSocket } from 'ws';

export const COMMAND_TIMEOUT_MS = 15_000;

export function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    const ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        const entry = msg.id ? pending.get(msg.id) : undefined;
        if (!entry) return;
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(msg.error.message)); else entry.resolve(msg.result);
    });
    return {
        ready,
        send: (method, params = {}) => new Promise((resolve, reject) => {
            const id = nextId++;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, COMMAND_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            ws.send(JSON.stringify({ id, method, params }));
        }),
        close: () => new Promise((resolve) => {
            if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
            ws.once('close', resolve);
            ws.close();
        }),
    };
}

/** Open a client and resolve only once its socket is open, so no command can precede readiness. */
export async function openReady(wsUrl) {
    const client = connect(wsUrl);
    await client.ready;
    return client;
}

/** Read-only: whether any debugger is attached to the page target or to a worker, from the browser endpoint. */
export function attachmentProbe(cdpOrigin, targetId) {
    return async () => {
        const { webSocketDebuggerUrl } = await (await fetch(`${cdpOrigin}/json/version`)).json();
        const browser = await openReady(webSocketDebuggerUrl);
        try {
            const { targetInfos } = await browser.send('Target.getTargets');
            const page = targetInfos.find((info) => info.targetId === targetId);
            if (!page) throw new Error('the app page target is gone');
            return { attached: page.attached === true || targetInfos.some((info) => /worker/.test(info.type) && info.attached === true) };
        } finally { await browser.close(); }
    };
}
