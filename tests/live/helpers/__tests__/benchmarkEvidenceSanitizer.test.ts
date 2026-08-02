import { describe, expect, it } from 'vitest';
import { sanitizePrivateBenchmarkEvidence } from '../benchmark-utils';

describe('#1132 Private browser benchmark evidence sanitization', () => {
    it('keeps default captured audio and private text outside the uploadable summary', () => {
        const audioDataUrl = `data:audio/wav;base64,${Buffer.from('checked-in fixture audio').toString('base64')}`;
        const sanitized = sanitizePrivateBenchmarkEvidence({
            root: {
                appReady: 'true',
                runtimeState: 'ready',
                sttReady: 'true',
                modelStatus: 'ready',
                sessionPersisted: 'true',
                transcriptState: 'available',
            },
            transcriptText: 'private speech from person@example.com',
            runtime: { transcript: 'private runtime transcript', userId: 'private-user-id' },
            privateTimeline: [{ transcript: 'private timeline words' }],
            privateTranscriptTrace: [{ text: 'private trace words' }],
            privateAudioChunks: [{
                samples: 16_000,
                durationSec: 1,
                rms: 0.25,
                peak: 0.75,
                wavDataUrlBytes: audioDataUrl.length,
                wavDataUrl: audioDataUrl,
                transcript: 'private chunk transcript',
            }],
            privateUtteranceAudioChunks: [{
                samples: 16_000,
                durationSec: 1,
                rms: 0.2,
                peak: 0.7,
                wavDataUrlBytes: audioDataUrl.length,
                wavDataUrl: audioDataUrl,
            }],
        }, 'private-cpu');

        expect(sanitized).toMatchObject({
            kind: 'private-browser-benchmark-summary',
            label: 'private-cpu',
            transcriptWordCount: 4,
            runtimePresent: true,
            privateTimelineEventCount: 1,
            privateTranscriptTraceEventCount: 1,
            privateAudioChunks: [{
                samples: 16_000,
                durationSec: 1,
                audioSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            }],
        });
        const serialized = JSON.stringify(sanitized);
        expect(serialized).not.toMatch(/person@example\.com|private speech|private runtime|private timeline|private trace|private chunk|data:audio|base64|checked-in fixture audio/i);
    });

    it('fails rather than emitting a summary for malformed captured audio', () => {
        expect(() => sanitizePrivateBenchmarkEvidence({
            privateAudioChunks: [{ wavDataUrl: 'data:audio/wav;base64,' }],
        }, 'private-cpu')).toThrow(/empty|base64 audio data URL/);
    });

    it('fails closed when the browser capture globals produce no hashed audio route', () => {
        expect(() => sanitizePrivateBenchmarkEvidence({
            privateAudioChunks: [],
            privateUtteranceAudioChunks: [],
        }, 'private-cpu')).toThrow(/at least one valid captured-audio hash/);

        expect(() => sanitizePrivateBenchmarkEvidence({
            privateAudioChunks: [{ samples: 16_000, durationSec: 1 }],
        }, 'private-cpu')).toThrow(/at least one valid captured-audio hash/);
    });
});
