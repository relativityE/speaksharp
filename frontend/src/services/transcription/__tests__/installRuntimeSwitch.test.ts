/**
 * #1426 — canonical Production carries a hidden CDP-only comparison surface.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installRuntimeCandidateSwitch } from '../installRuntimeSwitch';
import {
    registerSwitchExecutor, clearRuntimeCandidateOverride, MODEL_COMPARISON_CDP_ARM_KEY,
} from '../runtimeCandidateSwitch';
import { recordResolvedEngine, clearResolvedEngine } from '@/services/telemetry/runtimeAttribution';

interface SwitchWindow { __SS_SWITCH_CANDIDATE__?: unknown; __SS_ACTIVE_CANDIDATE__?: unknown }
const w = () => window as unknown as SwitchWindow;
const arm = () => Object.defineProperty(window, Symbol.for(MODEL_COMPARISON_CDP_ARM_KEY), {
    value: true, configurable: true,
});
const disarm = () => { delete (window as unknown as Record<symbol, unknown>)[Symbol.for(MODEL_COMPARISON_CDP_ARM_KEY)]; };

describe('installing the in-page model switch', () => {
    beforeEach(() => {
        delete w().__SS_SWITCH_CANDIDATE__;
        delete w().__SS_ACTIVE_CANDIDATE__;
        disarm();
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
    });
    afterEach(() => {
        clearResolvedEngine();
        delete w().__SS_SWITCH_CANDIDATE__;
        delete w().__SS_ACTIVE_CANDIDATE__;
        disarm();
        registerSwitchExecutor(null);
    });

    it('CASUALTY: ordinary canonical Production installs no switch', () => {
        expect(installRuntimeCandidateSwitch({})).toBe(false);
        expect(w().__SS_SWITCH_CANDIDATE__).toBeUndefined();
        expect(w().__SS_ACTIVE_CANDIDATE__).toBeUndefined();
    });

    it('CASUALTY: CDP-armed Production installs both functions, non-enumerably', () => {
        arm();
        expect(installRuntimeCandidateSwitch({})).toBe(true);
        expect(typeof w().__SS_SWITCH_CANDIDATE__).toBe('function');
        expect(typeof w().__SS_ACTIVE_CANDIDATE__).toBe('function');
        expect(Object.keys(window)).not.toContain('__SS_SWITCH_CANDIDATE__');
        expect(Object.keys(window)).not.toContain('__SS_ACTIVE_CANDIDATE__');
    });

    type Read = () => { requested: string; observed: string | null; expected: string; matches: boolean; source: string };

    it('CASUALTY: before any engine resolves, OBSERVED is null and matches is FALSE', () => {
        // The wrapper must never record a model from the request alone. Reporting the selection as
        // though it were the running engine is how a v2 recording gets labelled with another model.
        expect(installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' })).toBe(true);
        const read = w().__SS_ACTIVE_CANDIDATE__ as Read;
        expect(read()).toEqual({
            requested: 'v2:base.en', observed: null, expected: 'v2:base.en', matches: false, source: 'config',
        });
    });

    it('CASUALTY: a MISMATCH between request and running engine is reported, not hidden', () => {
        installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' });
        // The engine resolved something other than the configured selection.
        recordResolvedEngine({ candidateId: 'v4:base:q4', modelIdentity: { engine: 'transformers-js-v4' } });
        const r = (w().__SS_ACTIVE_CANDIDATE__ as Read)();
        expect(r.requested).toBe('v2:base.en');
        expect(r.observed).toBe('v4:base:q4');
        expect(r.matches).toBe(false);
    });

    it('POSITIVE CONTROL: agreement reports matches = true', () => {
        installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' });
        recordResolvedEngine({ candidateId: 'v2:base.en', modelIdentity: { engine: 'transformers-js' } });
        const r = (w().__SS_ACTIVE_CANDIDATE__ as Read)();
        expect(r).toEqual({
            requested: 'v2:base.en', observed: 'v2:base.en', expected: 'v2:base.en', matches: true, source: 'config',
        });
    });
});
