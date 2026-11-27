/** Local isolated real-worker proof only. No changes to the hosted journey observer or fault gate. */
import { attemptPhase, type AttemptPhase } from '../../live/helpers/rwtAdverseRecovery';

export interface IsolatedColdStartRead {
    token: string | null;
    states: string[];
    samePress: boolean;
    pendingDownloadAlias: boolean;
}

/** Browser-side: bind to the actual cold press, not to another route or a later button with the same test id. */
export function armIsolatedColdStartPress(): void {
    type Binding = { owner: Element; button: HTMLButtonElement; path: string; count: number };
    const w = window as unknown as { __j7IsolatedColdPress__?: Binding };
    document.addEventListener('click', (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        const button = event.target.closest('button[data-testid="mic-download"], button[data-testid="mic-start"], button[data-testid="mic-retry"]');
        if (!(button instanceof HTMLButtonElement)) return;
        if (w.__j7IsolatedColdPress__) { w.__j7IsolatedColdPress__.count += 1; return; }
        const owner = button.closest('[data-testid="session-page"]');
        if (owner && button.dataset.testid === 'mic-download') {
            w.__j7IsolatedColdPress__ = { owner, button, path: location.pathname, count: 1 };
        }
    }, { capture: true });
}

/** Browser-side: atomically sample the mutation log and the pending press's current visible control. */
export function readIsolatedColdStart(): IsolatedColdStartRead {
    const w = window as unknown as {
        __rwtRuntimeStateLog__?: { token: string; states: string[]; observer: MutationObserver; record: (records: MutationRecord[]) => void };
        __j7IsolatedColdPress__?: { owner: Element; button: HTMLButtonElement; path: string; count: number };
    };
    const log = w.__rwtRuntimeStateLog__;
    if (!log) return { token: null, states: [], samePress: false, pendingDownloadAlias: false };
    log.record(log.observer.takeRecords());
    const press = w.__j7IsolatedColdPress__;
    const samePress = !!press && press.count === 1 && press.path === location.pathname
        && press.owner === document.querySelector('[data-testid="session-page"]')
        && press.owner.querySelector('button[data-testid="mic-download"], button[data-testid="mic-start"], button[data-testid="mic-retry"]') === press.button;
    const pendingDownloadAlias = samePress
        && document.documentElement.getAttribute('data-model-status') === 'download-required'
        && press.button.disabled && press.button.getAttribute('aria-disabled') === 'true'
        && press.button.getAttribute('aria-label') === 'Starting…';
    return { token: log.token, states: log.states.slice(), samePress, pendingDownloadAlias };
}

export function isolatedColdStartPhase(read: IsolatedColdStartRead, token: string, from: number): AttemptPhase {
    if (!read.samePress || read.token !== token) return 'unobserved';
    const phase = attemptPhase({ observed: true, states: read.states }, from);
    const observed = read.states.slice(from);
    // initializeStrategy republishes the service's DOWNLOAD_REQUIRED as projected IDLE before its actual init.
    // Only the still-pending cold press plus its exact model status can make this *undecided*, never in-setup.
    // The unchanged controller still requires a new ENGINE_INITIALIZING read and a same-attempt held next file.
    return phase === 'left-setup' && observed[observed.length - 1] === 'IDLE' && read.pendingDownloadAlias
        && !observed.includes('READY') && !observed.includes('TERMINATED') ? 'pre-setup' : phase;
}
