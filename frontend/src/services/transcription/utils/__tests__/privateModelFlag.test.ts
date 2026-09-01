/**
 * #1263 — model resolution takes no input.
 *
 * The channel-inertness proofs (and therefore the retired parameter NAMES) live in the single
 * regression fixture, `__tests__/noSelectorChannels.guard.test.ts`. Repeating them here would spread
 * the retired vocabulary back through the suite, which is part of what made those names a problem.
 */
import { describe, it, expect } from 'vitest';
import { resolvePrivateModel } from '../privateModelFlag';
import { PRIV_STT_MODELS } from '../../sttConstants';

describe('privateModelFlag', () => {
    it('resolves the configured default and takes no argument', () => {
        expect(resolvePrivateModel()).toBe(PRIV_STT_MODELS.DEFAULT);
        expect(resolvePrivateModel.length).toBe(0);
    });

    it('POSITIVE CONTROL: the default is a real, registered model key', () => {
        expect(Object.keys(PRIV_STT_MODELS.CANDIDATES)).toContain(PRIV_STT_MODELS.DEFAULT);
    });
});
