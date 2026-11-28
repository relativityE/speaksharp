/**
 * Default-off meaning matcher — the Focus Points opt-in control. Flag off: nothing renders and no matcher is
 * touched. Flag on: nothing downloads until the press; the press records consent and starts the download with
 * truthful progress; ready is stated; a failure offers a retry; an earlier opt-in loads from cache only.
 */
import { act, fireEvent, render, screen } from '../../../../tests/support/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FocusMeaningOptIn, { MEANING_OPT_IN_LABEL, MEANING_READY_COPY } from '../FocusMeaningOptIn';
import { MeaningMatcher, peekMeaningMatcher, resetMeaningMatcherForTests } from '@/services/objective/meaning/MeaningMatcher';
import { MEANING_CONSENT_STORAGE_KEY, meaningConsentTerms, recordMeaningConsent } from '@/services/objective/meaning/meaningModelConsent';
import { MEANING_MODEL_APPROX_MB } from '@/services/objective/meaning/meaningAssetPins';
import { MEANING_NOT_CACHED } from '@/services/objective/meaning/meaningWorkerProtocol';
import { createFakeMeaningWorker, memoryStore, type FakeMeaningWorker } from '@/services/objective/meaning/__tests__/fakeMeaningWorker';

function install(store = memoryStore()) {
    const workers: FakeMeaningWorker[] = [];
    const matcher = new MeaningMatcher({
        createWorker: () => { const w = createFakeMeaningWorker(); workers.push(w); return w; },
        store,
        origin: 'https://app.test',
    });
    resetMeaningMatcherForTests(matcher);
    return { matcher, workers, store };
}

describe('FocusMeaningOptIn', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        resetMeaningMatcherForTests(null);
    });

    describe('flag off', () => {
        it.each(['', 'false', 'TRUE'])('flag=%j renders nothing and creates no matcher', (value) => {
            vi.stubEnv('VITE_FOCUS_MEANING_MATCHER_ENABLED', value);
            const { container } = render(<FocusMeaningOptIn />);
            expect(container).toBeEmptyDOMElement();
            expect(screen.queryByTestId('focus-meaning-opt-in')).not.toBeInTheDocument();
            expect(peekMeaningMatcher()).toBeNull();
        });
    });

    describe('flag on', () => {
        beforeEach(() => vi.stubEnv('VITE_FOCUS_MEANING_MATCHER_ENABLED', 'true'));

        it('quotes the pinned size and downloads nothing until pressed', () => {
            const { workers } = install();
            render(<FocusMeaningOptIn />);
            expect(screen.getByTestId('focus-meaning-enable')).toHaveTextContent(MEANING_OPT_IN_LABEL);
            expect(MEANING_OPT_IN_LABEL).toBe(`Enable meaning-based detection (about ${MEANING_MODEL_APPROX_MB} MB, one-time download)`);
            expect(workers).toHaveLength(0);
        });

        it('press → consent recorded + download started → progress → ready', async () => {
            const { workers, store } = install();
            render(<FocusMeaningOptIn />);
            fireEvent.click(screen.getByTestId('focus-meaning-enable'));

            expect(store.data.has(MEANING_CONSENT_STORAGE_KEY)).toBe(true);
            expect(workers).toHaveLength(1);
            const load = workers[0].last('load');
            expect(load.mode).toBe('download');

            act(() => workers[0].emit({ id: load.id, type: 'progress', pct: 42 }));
            expect(screen.getByTestId('focus-meaning-progress')).toHaveTextContent('Downloading meaning-based detection… 42%');
            expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');

            await act(async () => { workers[0].emit({ id: load.id, type: 'loaded', loadTimeMs: 3 }); });
            expect(screen.getByTestId('focus-meaning-ready')).toHaveTextContent(MEANING_READY_COPY);
            expect(screen.queryByTestId('focus-meaning-enable')).not.toBeInTheDocument();
        });

        it('failure → retry starts a fresh download', async () => {
            const { workers } = install();
            render(<FocusMeaningOptIn />);
            fireEvent.click(screen.getByTestId('focus-meaning-enable'));
            await act(async () => { workers[0].emit({ id: workers[0].last('load').id, type: 'error', code: 'MEANING_MODEL_DOWNLOAD_FAILED' }); });
            expect(screen.getByTestId('focus-meaning-failed')).toBeInTheDocument();

            fireEvent.click(screen.getByTestId('focus-meaning-retry'));
            expect(workers).toHaveLength(2);
            expect(workers[1].last('load').mode).toBe('download');
            await act(async () => { workers[1].emit({ id: workers[1].last('load').id, type: 'loaded', loadTimeMs: 1 }); });
            expect(screen.getByTestId('focus-meaning-ready')).toBeInTheDocument();
        });

        it('an earlier opt-in loads from cache only; a cache miss shows the button again (no download)', async () => {
            const store = memoryStore();
            recordMeaningConsent(meaningConsentTerms(), 'earlier', store);
            const { workers } = install(store);
            render(<FocusMeaningOptIn />);
            expect(workers).toHaveLength(1);
            expect(workers[0].last('load').mode).toBe('cache-only');
            expect(screen.getByTestId('focus-meaning-progress')).toHaveTextContent('Loading meaning-based detection…');

            await act(async () => { workers[0].emit({ id: workers[0].last('load').id, type: 'error', code: MEANING_NOT_CACHED }); });
            expect(screen.getByTestId('focus-meaning-enable')).toBeInTheDocument();
            expect(workers.flatMap((w) => w.sent).some((m) => m.type === 'load' && m.mode === 'download')).toBe(false);
        });
    });
});
