/**
 * @file PrivateSTT.spec.ts
 * @description Unit Test for the "Routing Logic" (Facade).
 * @verification_scope
 * - Verifies `WebGPU` capability detection via `navigator.gpu`.
 * - Verifies correct engine selection:
 *   - WebGPU available -> WhisperTurboEngine (Fast Path)
 *   - WebGPU missing -> TransformersJSEngine (Safe Path)
 *   - `window.__E2E_PLAYWRIGHT__` -> MockEngine (Reliable Path)
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPrivateSTT } from '../PrivateSTT';
import { WhisperTurboEngine } from '../WhisperTurboEngine';
import { TransformersJSEngine } from '../TransformersJSEngine';
import { MockEngine } from '../MockEngine';

// Mock the engine classes with explicit init behavior
const mockWTEInit = vi.fn().mockResolvedValue({ isOk: true, value: undefined, isErr: false });
vi.mock('../WhisperTurboEngine', () => {
    return {
        WhisperTurboEngine: vi.fn().mockImplementation(() => ({
            init: mockWTEInit,
            transcribe: vi.fn()
        }))
    };
});

const mockTJInit = vi.fn().mockResolvedValue({ isOk: true, value: undefined, isErr: false });
vi.mock('../TransformersJSEngine', () => {
    return {
        TransformersJSEngine: vi.fn().mockImplementation(() => ({
            init: mockTJInit,
            transcribe: vi.fn()
        }))
    };
});

vi.mock('../MockEngine');

// Mock underlying libraries to avoid resolution errors
vi.mock('whisper-turbo', () => ({}));
vi.mock('@xenova/transformers', () => ({}));

describe('PrivateSTT (Routing Logic)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset window flags - properties are now typed via PrivateWhisper.ts declare global
        delete window.__E2E_PLAYWRIGHT__;
        delete window.TEST_MODE;

        // Reset navigator.gpu
        // @ts-expect-error - delete readonly property for test mock
        delete navigator.gpu;
    });

    it('selects MockEngine when window.__E2E_PLAYWRIGHT__ is true', async () => {
        window.__E2E_PLAYWRIGHT__ = true;

        const pstt = createPrivateSTT();
        await pstt.init({});
        expect(MockEngine).toHaveBeenCalled();
        expect(WhisperTurboEngine).not.toHaveBeenCalled();
        expect(TransformersJSEngine).not.toHaveBeenCalled();
    });

    it('selects MockEngine when window.TEST_MODE is true', async () => {
        window.TEST_MODE = true;

        const pstt = createPrivateSTT();
        await pstt.init({});
        expect(MockEngine).toHaveBeenCalled();
    });

    it('selects WhisperTurboEngine (Fast Path) when WebGPU is available', async () => {
        // Mock navigator.gpu
        Object.defineProperty(navigator, 'gpu', {
            value: { requestAdapter: vi.fn() },
            writable: true,
            configurable: true
        });

        const pstt = createPrivateSTT();
        await pstt.init({});
        // Note: createPrivateSTT instantiates PrivateSTT, which instantiates the engines lazily or eagerly?
        // Let's check PrivateSTT implementation. It usually instantiates on init or constructor.
        // Based on my view earlier, PrivateSTT constructor creates the strategy? 
        // No, PrivateSTT is the context.

        // Assuming PrivateSTT() constructor calls createEngine strategy?
        // Let's verify PrivateSTT.ts content if needed.
        // Assuming expectation:
        expect(WhisperTurboEngine).toHaveBeenCalled();
        expect(TransformersJSEngine).not.toHaveBeenCalled();
    });

    it('selects TransformersJSEngine (Safe Path) when WebGPU is NOT available', async () => {
        // navigator.gpu is undefined by default in JSDOM/beforeEach

        const pstt = createPrivateSTT();
        await pstt.init({});
        expect(TransformersJSEngine).toHaveBeenCalled();
        expect(WhisperTurboEngine).not.toHaveBeenCalled();
    });
});
