// @vitest-environment jsdom
/**
 * #1593 (Sam, #1662 RETURN on f527a033 item 6) — live case 11's model-status history runs the SAME function the spec injects
 * into device B (`page.evaluate(installModelStatusHistory)`), here through a real MutationObserver. One observer callback can
 * carry several records; a `loading → download-required` pair inside one batch must still show `loading`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installModelStatusHistory, modelWorkBeforeRefusal } from '../live/helpers/rwtAbandonTakeover';

const history = () => (window as unknown as { __rwtModelStatusHistory__?: string[] }).__rwtModelStatusHistory__ ?? [];
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('installModelStatusHistory — every published model-status transition, in order', () => {
    afterEach(() => { document.documentElement.removeAttribute('data-model-status'); });

    it('keeps each transition of one observer batch (loading → download-required is not lost)', async () => {
        const root = document.documentElement;
        root.setAttribute('data-model-status', 'download-required');
        installModelStatusHistory();
        root.setAttribute('data-model-status', 'loading');
        root.setAttribute('data-model-status', 'download-required'); // same task: one callback, two records
        await flush();
        expect(history()).toEqual(['loading', 'download-required']);
        expect(modelWorkBeforeRefusal({ cold: true, modelRequests: 0, statusHistory: history(), statusAtRefusal: 'download-required' }),
            'the hidden loading is model work before the refusal').toBe(true);
    });

    it('a clean refusal publishes no transition and reads as no model work', async () => {
        document.documentElement.setAttribute('data-model-status', 'download-required');
        installModelStatusHistory();
        await flush();
        expect(history()).toEqual([]);
        expect(modelWorkBeforeRefusal({ cold: true, modelRequests: 0, statusHistory: history(), statusAtRefusal: 'download-required' })).toBe(false);
    });

    it('separate batches are each recorded, and a removed attribute is recorded as absent', async () => {
        const root = document.documentElement;
        root.setAttribute('data-model-status', 'download-required');
        installModelStatusHistory();
        root.setAttribute('data-model-status', 'loading');
        await flush();
        root.removeAttribute('data-model-status');
        await flush();
        expect(history()).toEqual(['loading', 'absent']);
    });
});
