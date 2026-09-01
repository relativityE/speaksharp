/**
 * #1263 — the Private model flag channel is RETIRED.
 *
 * This suite used to prove that `window.__PRIVATE_MODEL__` and `?privateModel=` were honoured, that the
 * selection source was reported as `window`/`url`, and that an unsupported requested model threw rather
 * than silently falling back.
 *
 * Every one of those described a per-visitor selection channel that had NO dev/test gate — it worked on
 * the production site, and the parameter named internal model builds to anyone reading a URL. The
 * channel is gone, so the assertions are inverted: nothing can request a model here any more.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    resolvePrivateModel, isPrivateModelOverridden, getRequestedPrivateModel,
    resolvePrivateModelSource, assertValidPrivateModelSelection,
} from '../privateModelFlag';
import { PRIV_STT_MODELS } from '../../sttConstants';

interface ModelWindow { __PRIVATE_MODEL__?: string }

describe('privateModelFlag — selection channel retired', () => {
    afterEach(() => {
        window.history.replaceState({}, '', '/');
        delete (window as unknown as ModelWindow).__PRIVATE_MODEL__;
        window.localStorage.clear();
    });

    it('CASUALTY: ?privateModel= cannot change the model', () => {
        window.history.replaceState({}, '', '?privateModel=whisper-small.en');
        expect(resolvePrivateModel()).toBe(PRIV_STT_MODELS.DEFAULT);
        expect(resolvePrivateModelSource()).toBe('default');
        expect(isPrivateModelOverridden()).toBe(false);
    });

    it('CASUALTY: the window global cannot change the model', () => {
        (window as unknown as ModelWindow).__PRIVATE_MODEL__ = 'whisper-small.en';
        expect(resolvePrivateModel()).toBe(PRIV_STT_MODELS.DEFAULT);
        expect(resolvePrivateModelSource()).toBe('default');
    });

    it('CASUALTY: nothing is ever reported as requested', () => {
        window.history.replaceState({}, '', '?privateModel=not-a-real-model');
        (window as unknown as ModelWindow).__PRIVATE_MODEL__ = 'also-not-real';
        expect(getRequestedPrivateModel()).toBeNull();
    });

    it('the unsupported-request guard no longer throws — there is no request to reject', () => {
        // It existed because a silent fallback made `?privateModel=` look honoured when it was not.
        // With no request channel, an unsupported candidate is refused at CONFIG selection instead,
        // before a session starts.
        window.history.replaceState({}, '', '?privateModel=not-a-real-model');
        expect(() => assertValidPrivateModelSelection()).not.toThrow();
    });

    it('POSITIVE CONTROL: the default is a real, registered model key', () => {
        expect(typeof PRIV_STT_MODELS.DEFAULT).toBe('string');
        expect(Object.keys(PRIV_STT_MODELS.CANDIDATES)).toContain(PRIV_STT_MODELS.DEFAULT);
    });
});
