/**
 * A MOONSHINE SESSION MUST NOT BE SAVED UNDER WHISPER'S NAME.
 *
 * `getMetadata()` computed its arm from `isV4 ? 'private_v4' : 'private_v2'` — a two-value boolean over
 * what is now three engines. Every Moonshine session therefore fell through the else branch and was
 * persisted as `private_v2` / `whisper-base.en`.
 *
 * This is worse than an ordinary mislabel. The whole point of #1390 is a human comparison BETWEEN these
 * models; an arm that records itself as a different arm does not merely lose its own label, it adds its
 * results to a competitor's. The arm would have been invisible in its own experiment.
 *
 * These tests drive the REAL facade and read the REAL metadata, rather than asserting on the source
 * text of the branch — a harness that recomputes the rule agrees with whatever the rule says.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANDIDATES } from '../../candidateRegistry';
import { CONSENT_STORAGE_KEY, consentTermsFor } from '../../modelConsent';
import { sttRegistry } from '../../STTRegistry';
import type { IPrivateSTTEngine } from '../../../../contracts/IPrivateSTTEngine';

vi.mock('../../candidateSelection', async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return {
        ...actual,
        effectiveCandidate: () => ({
            candidate: CANDIDATES['moonshine:streaming-medium'],
            fallbackCause: null,
        }),
    };
});

const fakeMoonshineEngine = (): IPrivateSTTEngine => ({
    init: vi.fn(async () => ({ isOk: true, data: undefined })),
    // The decode method a real recording uses. A double that omits it cannot exercise the path under
    // test and would pass while the shipping engine threw.
    transcribe: vi.fn(async () => ({ isOk: true, data: '' })),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    terminate: vi.fn(async () => {}),
    getTranscript: vi.fn(async () => ''),
    getInterimTranscript: vi.fn(() => ''),
} as unknown as IPrivateSTTEngine);

describe('a Moonshine session reports Moonshine', () => {
    beforeEach(() => {
        sttRegistry.register('moonshine-streaming', () => fakeMoonshineEngine() as never);
    });
    afterEach(() => { sttRegistry.clear(); vi.restoreAllMocks(); });

    it('CASUALTY: metadata names the Moonshine arm and model, never private_v2/whisper-base.en', async () => {
        const { PrivateSTT } = await import('../PrivateSTT');
        const pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        const meta = pstt.getMetadata();
        expect(meta.modelName, 'a Moonshine session saved as whisper-base.en').not.toBe('whisper-base.en');
        expect(meta.engineVersion).not.toContain('private_v2');
        expect(meta.engineVersion).toContain('private_moonshine');
        expect(meta.modelName).toBe(CANDIDATES['moonshine:streaming-medium'].model.id);
        expect(meta.candidateId).toBe('moonshine:streaming-medium');
    });

    it('CASUALTY: the persisted identity is the registry entry for the arch that loaded', async () => {
        const { PrivateSTT } = await import('../PrivateSTT');
        const pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();

        const identity = pstt.getMetadata().modelIdentity;
        expect(identity, 'a Moonshine session with no model identity is unusable as evidence').toBeTruthy();
        expect(identity?.configuredModel.id).toBe('medium-streaming-en');
        // The pin is what makes the downloaded bytes attributable; an identity carrying a model name
        // but no digest describes a model we cannot prove we ran.
        expect(identity?.configuredAssets.pinDigest)
            .toBe(CANDIDATES['moonshine:streaming-medium'].assets.pinDigest);
    });
});

describe('readiness for Moonshine is a consent question, not a cache question', () => {
    beforeEach(() => {
        sttRegistry.register('moonshine-streaming', () => fakeMoonshineEngine() as never);
        window.localStorage.clear();
    });
    afterEach(() => { sttRegistry.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

    it('CASUALTY: with NO consent, readiness asks — quoting Moonshine size, not v2 cache state', async () => {
        const { PrivateSTT } = await import('../PrivateSTT');
        const pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });

        const availability = await pstt.checkAvailability();
        expect(availability.isAvailable).toBe(false);
        // NOT `CACHE_MISS`: that asserts the assets are absent, which for a runtime that manages its own
        // storage we cannot observe. This says only that we lack the user's agreement.
        expect(availability.reason).toBe('CONSENT_REQUIRED');
        expect(availability.sizeMB).toBe(305);
        expect(availability.message).toMatch(/may download up to 305 MB/);
        expect(availability.message).not.toMatch(/cached|already downloaded/i);
    });

    it('CASUALTY: consent lets initialization proceed but never by itself means READY', async () => {
        const terms = consentTermsFor(CANDIDATES['moonshine:streaming-medium']);
        window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
            [terms.candidateId]: { ...terms, grantedAt: '2026-09-01T00:00:00.000Z' },
        }));

        const { PrivateSTT } = await import('../PrivateSTT');
        const pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });

        expect((await pstt.checkAvailability()).isAvailable, 'no repeat prompt with a valid receipt').toBe(true);
        // Availability is permission to TRY. Identity stays absent until a real engine has initialised
        // and published it -- consent must never be able to manufacture a READY-looking session.
        expect(pstt.getMetadata().candidateId).toBeUndefined();

        await pstt.init();
        expect(pstt.getMetadata().candidateId).toBe('moonshine:streaming-medium');
    });
});

describe('a committed utterance reaches Moonshine through the REAL facade', () => {
    /**
     * `PrivateWhisper` commits an utterance with `privateSTT.transcribe(audio)`. The earlier proof called
     * `engine.transcribe(audio)` directly, which skips the facade entirely — the very hop where the
     * engine was missing the method. A test that bypasses the layer under repair cannot show it is
     * repaired.
     *
     * Only the RUNTIME is a double here, and it implements the published surface. Everything from
     * `PrivateSTT.transcribe` down is production code.
     */
    const runtimeSpy = { received: [] as number[], decodes: 0 };

    const realRuntimeDouble = () => ({
        transcribe: () => { throw new Error('the non-streaming API must not be used in a session'); },
        close: vi.fn(() => {}),
        createStream: () => ({
            start: vi.fn(),
            addAudio: (audio: Float32Array) => { runtimeSpy.received.push(audio.length); },
            transcribe: () => { runtimeSpy.decodes += 1; return { lines: [{ text: 'the real facade decoded this' }] }; },
            stop: vi.fn(),
            close: vi.fn(),
        }),
    });

    beforeEach(async () => {
        runtimeSpy.received = []; runtimeSpy.decodes = 0;
        const { MoonshineStreamingEngine } = await import('../MoonshineStreamingEngine');
        // The REAL engine, constructed by the REAL facade; only its transcriber is injected.
        sttRegistry.register('moonshine-streaming', ((options: unknown) => new MoonshineStreamingEngine({
            candidateId: 'moonshine:streaming-medium',
            modelArch: 'MOONSHINE_STREAMING_MEDIUM',
            loadTranscriber: async () => realRuntimeDouble(),
            ...(options as object),
        })) as never);
        window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
            'moonshine:streaming-medium': {
                ...consentTermsFor(CANDIDATES['moonshine:streaming-medium']),
                grantedAt: '2026-09-01T00:00:00.000Z',
            },
        }));
    });
    afterEach(() => { sttRegistry.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

    it('POSITIVE CONTROL: PrivateSTT.transcribe(audio) decodes on Moonshine and returns its text', async () => {
        const { PrivateSTT } = await import('../PrivateSTT');
        const pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        expect(pstt.getEngineType()).toBe('moonshine-streaming');

        const audio = new Float32Array(16_000 * 2).fill(0.1);
        const result = await pstt.transcribe(audio);

        expect(result.isOk, 'the facade commit decode must succeed on Moonshine').toBe(true);
        expect(result.isOk && result.data).toBe('the real facade decoded this');
        // The audio crossed every hop and reached the runtime intact.
        expect(runtimeSpy.received).toEqual([audio.length]);
        expect(runtimeSpy.decodes).toBe(1);
        // And the session is still attributed to Moonshine, not to a fallback.
        expect(pstt.getMetadata().candidateId).toBe('moonshine:streaming-medium');
    });

    it('CASUALTY: the facade does NOT silently re-transcribe on v2 when Moonshine decode fails', async () => {
        const { MoonshineStreamingEngine } = await import('../MoonshineStreamingEngine');
        sttRegistry.clear();
        sttRegistry.register('moonshine-streaming', (() => new MoonshineStreamingEngine({
            candidateId: 'moonshine:streaming-medium',
            modelArch: 'MOONSHINE_STREAMING_MEDIUM',
            loadTranscriber: async () => ({
                transcribe: () => ({ lines: [{ text: 'whisper would say this' }] }),
                close: vi.fn(() => {}),
                createStream: () => ({
                    start: vi.fn(), addAudio: vi.fn(),
                    transcribe: () => { throw new Error('moonshine decode failed'); },
                    stop: vi.fn(), close: vi.fn(),
                }),
            }),
        })) as never);

        const { PrivateSTT } = await import('../PrivateSTT');
        const pstt = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        await pstt.init();
        const result = await pstt.transcribe(new Float32Array(16_000).fill(0.1));

        expect(result.isOk).toBe(false);
        // A failed Moonshine decode that quietly returned another model's text would be scored as
        // Moonshine's output — the substitution this whole workstream exists to prevent.
        expect(JSON.stringify(result)).not.toContain('whisper would say this');
    });
});
