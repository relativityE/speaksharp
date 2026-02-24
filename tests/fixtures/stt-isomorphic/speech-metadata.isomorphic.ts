/**
 * @file speech-metadata.isomorphic.ts
 * @description Centralized contract for Speech STT expectations.
 * Used by both Playwright E2E and Backend Integration tests.
 */

export interface SpeechFixture {
    id: string;
    audioPath: string;
    expectedTranscript: string;
    expectedFillers: Record<string, number>;
    werThreshold: number;
}

export const SPEECH_FIXTURES: Record<string, SpeechFixture> = {
    'speech-001-clear-formal': {
        id: 'speech-001-clear-formal',
        audioPath: '/tests/assets/speech-001.wav',
        expectedTranscript: 'Hello everyone. Today we are going to talk about the importance of clear communication in technical leadership.',
        expectedFillers: { 'um': 0, 'uh': 0 },
        werThreshold: 0.05
    },
    'speech-002-casual-fillers': {
        id: 'speech-002-casual-fillers',
        audioPath: '/tests/assets/speech-002.wav',
        expectedTranscript: 'So, um, I was thinking like, maybe we should, uh, investigate the new API endpoints actually.',
        expectedFillers: { 'um': 1, 'uh': 1, 'like': 1, 'actually': 1 },
        werThreshold: 0.15
    },
    'speech-004-technical-vocab': {
        id: 'speech-004-technical-vocab',
        audioPath: '/tests/assets/speech-004.wav',
        expectedTranscript: 'We need to optimize the WebGPU kernels for the TransformersJS implementation to avoid main thread blockage during the WASM instantiation.',
        expectedFillers: {},
        werThreshold: 0.10
    }
};
