/**
 * #1426 — canonical Production carries a hidden CDP-only comparison surface.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installRuntimeCandidateSwitch } from '../installRuntimeSwitch';
import {
    registerSwitchExecutor, clearRuntimeCandidateOverride,
} from '../runtimeCandidateSwitch';
import { placeSignedAuthorization, resetAuthorization } from './modelComparisonAuthorization.helper';
import { recordResolvedEngine, clearResolvedEngine } from '@/services/telemetry/runtimeAttribution';

interface SwitchWindow { __SS_SWITCH_CANDIDATE__?: unknown; __SS_ACTIVE_CANDIDATE__?: unknown }
const w = () => window as unknown as SwitchWindow;

describe('installing the in-page model switch', () => {
    beforeEach(() => {
        delete w().__SS_SWITCH_CANDIDATE__;
        delete w().__SS_ACTIVE_CANDIDATE__;
        resetAuthorization();
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
    });
    afterEach(() => {
        clearResolvedEngine();
        delete w().__SS_SWITCH_CANDIDATE__;
        delete w().__SS_ACTIVE_CANDIDATE__;
        resetAuthorization();
        registerSwitchExecutor(null);
    });

    it('CASUALTY: ordinary canonical Production installs no switch', async () => {
        expect(await installRuntimeCandidateSwitch({})).toBe(false);
        expect(w().__SS_SWITCH_CANDIDATE__).toBeUndefined();
        expect(w().__SS_ACTIVE_CANDIDATE__).toBeUndefined();
    });

    it('CASUALTY: signed Production authorization installs both functions, non-enumerably', async () => {
        const { env } = placeSignedAuthorization();
        expect(await installRuntimeCandidateSwitch(env)).toBe(true);
        expect(typeof w().__SS_SWITCH_CANDIDATE__).toBe('function');
        expect(typeof w().__SS_ACTIVE_CANDIDATE__).toBe('function');
        expect(Object.keys(window)).not.toContain('__SS_SWITCH_CANDIDATE__');
        expect(Object.keys(window)).not.toContain('__SS_ACTIVE_CANDIDATE__');
    });

    type Read = () => { requested: string; observed: string | null; expected: string; matches: boolean; source: string };

    it('CASUALTY: before any engine resolves, OBSERVED is null and matches is FALSE', async () => {
        // The wrapper must never record a model from the request alone. Reporting the selection as
        // though it were the running engine is how a v2 recording gets labelled with another model.
        expect(await installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' })).toBe(true);
        const read = w().__SS_ACTIVE_CANDIDATE__ as Read;
        expect(read()).toEqual({
            requested: 'v2:base.en', observed: null, expected: 'v2:base.en', matches: false, source: 'config',
        });
    });

    it('CASUALTY: a MISMATCH between request and running engine is reported, not hidden', async () => {
        await installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' });
        // The engine resolved something other than the configured selection.
        recordResolvedEngine({ candidateId: 'v4:base:q4', modelIdentity: { engine: 'transformers-js-v4' } });
        const r = (w().__SS_ACTIVE_CANDIDATE__ as Read)();
        expect(r.requested).toBe('v2:base.en');
        expect(r.observed).toBe('v4:base:q4');
        expect(r.matches).toBe(false);
    });

    it('POSITIVE CONTROL: agreement reports matches = true', async () => {
        await installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' });
        recordResolvedEngine({ candidateId: 'v2:base.en', modelIdentity: { engine: 'transformers-js' } });
        const r = (w().__SS_ACTIVE_CANDIDATE__ as Read)();
        expect(r).toEqual({
            requested: 'v2:base.en', observed: 'v2:base.en', expected: 'v2:base.en', matches: true, source: 'config',
        });
    });
});
