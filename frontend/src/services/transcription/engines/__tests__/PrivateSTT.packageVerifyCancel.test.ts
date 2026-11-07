// @vitest-environment happy-dom
/**
 * Codex P2 on 66f048d0 (PrivateSTT.ts onInit): an imported package's init awaited `verifyModelPackage()` BEFORE it read
 * its lifecycle generation. A terminate() and a new init() during that await let the cancelled attempt read the NEW
 * generation, pass every ownership check, and acquire a second engine that could replace the newer one.
 *
 * Here the real facade runs with an imported-package selection whose verification is held open. Only the package
 * verification and the engine (registry stub) are doubles, so "the cancelled attempt acquired nothing" is the proof.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupStrictZero } from '../../../../../../tests/setupStrictZero';
import { Result } from '../../modes/types';
import { STTEngine } from '../../../../contracts/STTEngine';

vi.mock('@xenova/transformers', () => ({}));

const verification = vi.hoisted(() => ({ gates: [] as Array<() => void> }));
vi.mock('../../modelPackage', async (original) => {
    const actual = await original<typeof import('../../modelPackage')>();
    return {
        ...actual,
        // Each init's package verification waits until the test releases it.
        verifyModelPackage: vi.fn(() => new Promise<void>((resolve) => { verification.gates.push(resolve); })),
    };
});

const created: StubTJ[] = [];
/** Each acquired engine's model load waits until the test releases it. */
const loads: Array<(result: Result<void, Error>) => void> = [];
class StubTJ extends STTEngine {
    type = 'transformers-js' as const;
    checkAvailability = vi.fn().mockResolvedValue({ available: true });
    protected onInit = vi.fn(() => new Promise<Result<void, Error>>((resolve) => { loads.push(resolve); }));
    onStart = vi.fn().mockResolvedValue(undefined);
    onStop = vi.fn().mockResolvedValue(undefined);
    onPause = vi.fn().mockResolvedValue(undefined);
    onResume = vi.fn().mockResolvedValue(undefined);
    onDestroy = vi.fn().mockResolvedValue(undefined);
    transcribe = vi.fn();
}

describe('an init cancelled while its package is being verified acquires nothing', () => {
    beforeEach(async () => {
        globalThis.__TEST__ = true;
        created.length = 0;
        loads.length = 0;
        verification.gates.length = 0;
        await setupStrictZero();
        const { sttRegistry } = await import('../../STTRegistry');
        sttRegistry.register('transformers-js', (options) => {
            const engine = new StubTJ(options);
            created.push(engine);
            return engine;
        });
        const win = window as unknown as { __SS_E2E__: { isActive: boolean; engineType: string } };
        win.__SS_E2E__.isActive = false;
        win.__SS_E2E__.engineType = 'mock';
        window.localStorage.clear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        delete (window as unknown as Record<string, unknown>).__SS_E2E__;
    });

    it('terminate() then init() during verification: the old attempt resumes, acquires nothing, and cannot replace the new engine', async () => {
        const { PrivateSTT } = await import('../PrivateSTT');
        // The selected candidate carries an imported package, so onInit verifies it before acquiring an engine.
        const proto = PrivateSTT.prototype as unknown as { resolvedSelection(freeze?: boolean): { candidate: Record<string, unknown> } };
        const real = proto.resolvedSelection;
        vi.spyOn(proto, 'resolvedSelection').mockImplementation(function (this: unknown, freeze?: boolean) {
            const selection = real.call(this, freeze);
            return { ...selection, candidate: { ...selection.candidate, modelPackage: { descriptor: { fixture: true } } } };
        });
        const pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });

        const old = pstt.init();
        await vi.waitFor(() => expect(verification.gates).toHaveLength(1));
        await pstt.terminate();
        const fresh = pstt.init();
        await vi.waitFor(() => expect(verification.gates).toHaveLength(2));
        // The new attempt verifies and starts loading its engine; that load is still in flight...
        verification.gates[1]();
        await vi.waitFor(() => expect(loads).toHaveLength(1));
        // ...when the cancelled attempt's verification finishes. Before the fix it read the NEW generation here and
        // acquired a second engine of its own.
        verification.gates[0]();
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        expect(created, 'the cancelled attempt acquired a second engine').toHaveLength(1);
        const result = await old;
        expect(result.isOk).toBe(false);

        loads[0](Result.ok(undefined));
        expect((await fresh).isOk).toBe(true);
        expect(created).toHaveLength(1);
        expect(created[0].onDestroy).not.toHaveBeenCalled();
        await pstt.terminate();
        expect(created[0].onDestroy).toHaveBeenCalledTimes(1);
    });
});
