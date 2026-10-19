// @vitest-environment jsdom
/** Independent case13 service -> DOM/store -> real view probes. Only the engine/network boundary is faked.
 * This fixture explicitly composes the production DOM-status projection; it does not execute useSessionLifecycle.
 * No real model, microphone, provider, Auth or persistence is used. No product implementation is changed.
 */
import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { render } from '../../../../tests/support/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TranscriptionService from '@/services/transcription/TranscriptionService';
import { STTStrategyFactory } from '@/services/transcription/STTStrategyFactory';
import { Result } from '@/services/transcription/modes/types';
import { useSessionStore } from '@/stores/useSessionStore';
import { isPrivateModelBlockingStart } from '@/services/transcription/privateModelStartBlock';
import { SessionOverhaulView } from '../SessionOverhaulView';

vi.mock('@/services/transcription/STTStrategyFactory');
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const policy = { allowPrivate: true, allowNative: false, allowFallback: false, preferredMode: 'private', executionIntent: 'test' } as const;
const flush = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };
const services: TranscriptionService[] = [];
function engine(overrides: Record<string, unknown> = {}) {
    return {
        checkAvailability: vi.fn().mockResolvedValue({ isAvailable: true }),
        init: vi.fn().mockResolvedValue(Result.ok(undefined)),
        start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
        terminate: vi.fn().mockResolvedValue(undefined), getEngineType: vi.fn().mockReturnValue('transformers-js'),
        ...overrides,
    };
}
function service(e: ReturnType<typeof engine>) {
    vi.mocked(STTStrategyFactory.create).mockReturnValue(e as unknown as ReturnType<typeof STTStrategyFactory.create>);
    const s = new TranscriptionService({
        onTranscriptUpdate: vi.fn(), onReady: vi.fn(), onModelLoadProgress: vi.fn(),
        onStatusChange: vi.fn(), session: null, navigate: vi.fn(), getAssemblyAIToken: vi.fn(), policy,
    });
    services.push(s);
    return s;
}
function View({ retry }: { retry: () => void }) {
    const status = useSessionStore((s) => s.sttStatus);
    const [model, setModel] = useState(() => document.documentElement.getAttribute('data-model-status') ?? 'idle');
    useEffect(() => {
        const observer = new MutationObserver(() => setModel(document.documentElement.getAttribute('data-model-status') ?? 'idle'));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-model-status'] });
        return () => observer.disconnect();
    }, []);
    return <SessionOverhaulView authUserId="pm-probe-owner" isListening={false} sttStatus={status}
        privateModelStatus={model} isButtonDisabled={isPrivateModelBlockingStart('private', model)}
        elapsedTime={0} micLevel={0} transcriptContent="" showAnalyticsPrompt={false} metricsFillerCount={0}
        history={[]} onStartStop={vi.fn()} onDownloadModel={retry} />;
}
const project = (s: TranscriptionService) => {
    const retry = vi.fn(() => { void s.initiateDownload('private'); });
    render(<View retry={retry} />);
    return retry;
};
const expectRetry = () => {
    const retry = screen.getByTestId('mic-retry');
    expect(retry).toBeEnabled();
    expect(screen.getByTestId('mic-status')).toHaveTextContent(/needs another try/i);
    expect(screen.queryByText('Mic ready on this device')).not.toBeInTheDocument();
    return retry;
};

beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().resetSession();
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setProgressGateResolvedFor('pm-probe-owner');
    useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready' });
    document.documentElement.setAttribute('data-model-status', 'idle');
});
afterEach(async () => {
    cleanup();
    for (const s of services.splice(0)) await s.destroy();
});

describe('Browser PM case13: public service transitions drive actual rendered failure/retry controls', () => {
    it('control: unavailable strategy is an availability failure, never an attempted model initialization', async () => {
        const e = engine({ checkAvailability: vi.fn().mockResolvedValue({ isAvailable: false, reason: 'UNSUPPORTED', message: 'Unavailable engine' }) });
        const s = service(e); project(s);
        await act(async () => { await s.warmUp('private'); await flush(); });
        expect(e.init).not.toHaveBeenCalled();
        expect(s.getState()).toBe('FAILED');
        expect(document.documentElement.getAttribute('data-model-status')).toBe('error');
        expectRetry();
    });

    it.each(['returned-error', 'rejected-promise'] as const)('actual initialization %s remains visible with enabled Retry before teardown', async (kind) => {
        const init = kind === 'returned-error' ? vi.fn().mockResolvedValue(Result.err(new Error('weight fetch failed'))) : vi.fn().mockRejectedValue(new Error('weight fetch failed'));
        const s = service(engine({ init })); project(s);
        await act(async () => { await s.initiateDownload('private'); await flush(); });
        expect(init).toHaveBeenCalledTimes(1);
        expect(s.getState()).toBe('INIT_FAILED');
        expect(document.documentElement.getAttribute('data-model-status')).toBe('init-failed');
        expectRetry();
    });

    it('real Retry control re-enters initialization and renders ready on successful recovery', async () => {
        const init = vi.fn().mockResolvedValueOnce(Result.err(new Error('weight fetch failed'))).mockResolvedValue(Result.ok(undefined));
        const s = service(engine({ init })); const retry = project(s);
        await act(async () => { await s.initiateDownload('private'); await flush(); });
        await act(async () => { fireEvent.click(expectRetry()); await flush(); });
        expect(retry).toHaveBeenCalledTimes(1);
        expect(init).toHaveBeenCalledTimes(2);
        expect(s.getState()).toBe('READY');
        expect(screen.getByTestId('mic-start')).toBeEnabled();
        expect(screen.queryByTestId('mic-retry')).not.toBeInTheDocument();
    });

    it('RED: destroying the failed initialization service must not erase the visible failure and Retry', async () => {
        const s = service(engine({ init: vi.fn().mockResolvedValue(Result.err(new Error('weight fetch failed'))) })); project(s);
        await act(async () => { await s.initiateDownload('private'); await flush(); });
        expectRetry();
        await act(async () => { await s.destroy(); await flush(); });
        expect(document.documentElement.getAttribute('data-model-status'), 'failure should not be projected as ordinary ready/idle teardown').toBe('init-failed');
        expectRetry();
    });

    it('RED: reset after a failed model setup must not silently replace Retry with ready Start', async () => {
        const s = service(engine({ init: vi.fn().mockResolvedValue(Result.err(new Error('weight fetch failed'))) })); project(s);
        await act(async () => { await s.initiateDownload('private'); await flush(); });
        expectRetry();
        await act(async () => { s.reset(); await flush(); });
        expect(screen.queryByTestId('mic-retry'), 'plain reset loses the failure unless explicit recovery owns the transition').toBeInTheDocument();
    });

    it('RED: late destroy of old A must not overwrite the loading state of live successor B', async () => {
        const a = service(engine());
        await act(async () => { await a.warmUp('private'); await flush(); });
        let finish!: (result: ReturnType<typeof Result.ok>) => void;
        const pending = new Promise<ReturnType<typeof Result.ok>>((resolve) => { finish = resolve; });
        const b = service(engine({ init: vi.fn().mockReturnValue(pending) })); project(b);
        const warming = b.initiateDownload('private');
        await act(async () => { await flush(); });
        expect(document.documentElement.getAttribute('data-model-status')).toBe('loading');
        await act(async () => { await a.destroy(); await flush(); });
        const observed = document.documentElement.getAttribute('data-model-status');
        // Finish the owned async operation before evaluating the assertion, even when the observation is wrong.
        await act(async () => { finish(Result.ok(undefined)); await warming; await flush(); });
        expect(observed, 'A terminal/reset projection must not replace B loading').toBe('loading');
    });

    it('control: ordinary successful teardown with no unresolved failure may return to idle', async () => {
        const s = service(engine()); project(s);
        await act(async () => { await s.warmUp('private'); await s.destroy(); await flush(); });
        expect(document.documentElement.getAttribute('data-model-status')).toBe('idle');
        expect(screen.getByTestId('mic-start')).toBeEnabled();
    });

    it('control: a cache miss requests download and does not pretend initialization failed', async () => {
        const e = engine({ checkAvailability: vi.fn().mockResolvedValue({ isAvailable: false, reason: 'CACHE_MISS' }) });
        const s = service(e); project(s);
        await act(async () => { await s.warmUp('private'); await flush(); });
        expect(e.init).not.toHaveBeenCalled();
        expect(screen.getByTestId('mic-download')).toBeEnabled();
        expect(screen.queryByTestId('mic-retry')).not.toBeInTheDocument();
    });
});
