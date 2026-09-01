/**
 * #1263 — the v4 experiment override channel is RETIRED.
 *
 * This suite used to prove that `?v4Device`, `?v4Variant`, `?v4DecoderDtype`, `?v4NoWorker` and
 * `?v4ForceAuto` (plus their localStorage twins) were honoured in dev/test and inert in production.
 * The channel itself is now gone, so those assertions describe behaviour that no longer exists.
 *
 * What replaces them is the opposite claim: no input of any kind reaches this function.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getV4ExperimentOverrides } from '../privateV4Experiment';

const KEYS = [
    'v4Device', 'v4Variant', 'v4DecoderDtype', 'v4NoWorker', 'v4ForceAuto',
    'privateEngine', 'privateModel',
];
const STORAGE_KEYS = [
    'speaksharp.v4.device', 'speaksharp.v4.variant', 'speaksharp.v4.decoderDtype',
    'speaksharp.v4.noWorker', 'speaksharp.v4.forceAuto', 'speaksharp.private.engine',
];

describe('the v4 experiment override channel', () => {
    afterEach(() => {
        window.history.replaceState({}, '', '/');
        window.localStorage.clear();
    });

    it('CASUALTY: no URL parameter changes the result', () => {
        window.history.replaceState({}, '', `?${KEYS.map((k) => `${k}=webgpu`).join('&')}`);
        expect(getV4ExperimentOverrides()).toEqual({ noWorker: false, forceAuto: false });
    });

    it('CASUALTY: no localStorage key changes the result', () => {
        for (const k of STORAGE_KEYS) window.localStorage.setItem(k, '1');
        expect(getV4ExperimentOverrides()).toEqual({ noWorker: false, forceAuto: false });
    });

    it('CASUALTY: device, variant and dtype can no longer be expressed at all', () => {
        window.history.replaceState({}, '', '?v4Device=webgpu&v4Variant=distil_q4&v4DecoderDtype=int8');
        const o = getV4ExperimentOverrides() as unknown as Record<string, unknown>;
        expect(o.device).toBeUndefined();
        expect(o.variant).toBeUndefined();
        expect(o.decoderDtype).toBeUndefined();
    });

    it('takes no argument — there is no window to read from', () => {
        expect(getV4ExperimentOverrides.length).toBe(0);
    });
});
