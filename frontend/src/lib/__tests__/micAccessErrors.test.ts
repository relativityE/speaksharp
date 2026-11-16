import { describe, expect, it } from 'vitest';
import {
    MIC_ACCESS_MESSAGES, MIC_BLOCKED_MESSAGE, MIC_IN_USE_MESSAGE, MIC_NOT_FOUND_MESSAGE,
    isMicAccessMessage, isMicAcquisitionError, markMicAcquisitionError, micAccessIssue,
} from '../micAccessErrors';
import { sanitizeStartError, toSanitizedCause } from '../sanitizeStartError';

const named = (name: string, message = 'private diagnostic text') => Object.assign(new Error(message), { name });
const fromGetUserMedia = (name: string) => markMicAcquisitionError(new DOMException('private diagnostic text', name));
const wrapped = (cause: unknown) =>
    Object.assign(new Error('TRANSCRIPTION_START_DID_NOT_RECORD:FAILED'), { cause: toSanitizedCause(cause) });

describe('micAccessIssue — which microphone problem stopped the start', () => {
    it.each([
        ['NotAllowedError', 'blocked'], ['PermissionDeniedError', 'blocked'], ['SecurityError', 'blocked'],
        ['NotFoundError', 'not_found'], ['DevicesNotFoundError', 'not_found'],
        ['NotReadableError', 'in_use'], ['TrackStartError', 'in_use'],
    ] as const)('getUserMedia %s is %s, bare and through the controller\'s sanitized start wrapper', (name, issue) => {
        expect(micAccessIssue(fromGetUserMedia(name))).toBe(issue);
        expect(micAccessIssue(wrapped(fromGetUserMedia(name)))).toBe(issue);
    });

    it.each(['SecurityError', 'NotFoundError', 'NotReadableError'])(
        'an unmarked %s (storage, model cache, file read) is not called a microphone problem', (name) => {
            expect(micAccessIssue(named(name))).toBeNull();
            expect(micAccessIssue(wrapped(named(name)))).toBeNull();
        });

    it('a permission name is a denial wherever it came from (unchanged behaviour)', () => {
        expect(micAccessIssue(named('NotAllowedError'))).toBe('blocked');
        expect(micAccessIssue(wrapped(named('PermissionDeniedError')))).toBe('blocked');
    });

    it('reads a cause only behind the start wrapper, and never classifies message text', () => {
        const other = Object.assign(new Error('RECORDING_START_FAILED'), { cause: fromGetUserMedia('NotFoundError') });
        expect(micAccessIssue(other)).toBeNull();
        expect(micAccessIssue(new Error('NotFoundError: no microphone'))).toBeNull();
        expect(micAccessIssue(null)).toBeNull();
        expect(micAccessIssue('NotAllowedError')).toBeNull();
    });
});

describe('the copy', () => {
    it('each issue has its own actionable line, and the blocked line keeps its original opening verbatim', () => {
        expect(MIC_ACCESS_MESSAGES).toEqual({ blocked: MIC_BLOCKED_MESSAGE, not_found: MIC_NOT_FOUND_MESSAGE, in_use: MIC_IN_USE_MESSAGE });
        expect(MIC_BLOCKED_MESSAGE.startsWith('Microphone access is blocked. Allow microphone access and try again. ')).toBe(true);
        expect(MIC_BLOCKED_MESSAGE).toMatch(/set Microphone to Allow/);
        expect(MIC_NOT_FOUND_MESSAGE).toMatch(/^No microphone was found\./);
        expect(MIC_IN_USE_MESSAGE).toMatch(/in use by another app or tab/);
        for (const copy of Object.values(MIC_ACCESS_MESSAGES)) expect(copy).not.toMatch(/—|–/);
    });

    it('recognises its own copy, with or without the status warning sign', () => {
        expect(isMicAccessMessage(MIC_NOT_FOUND_MESSAGE)).toBe(true);
        expect(isMicAccessMessage(`⚠️ ${MIC_IN_USE_MESSAGE}`)).toBe(true);
        expect(isMicAccessMessage('Requested device not found')).toBe(false);
        expect(isMicAccessMessage(undefined)).toBe(false);
    });
});

describe('the getUserMedia marker', () => {
    it('is a closed, non-enumerable boolean that survives sanitizing and adds nothing else', () => {
        const leaf = fromGetUserMedia('NotFoundError');
        expect(isMicAcquisitionError(leaf)).toBe(true);
        expect(Object.keys(leaf)).not.toContain('micAcquisition');
        expect(sanitizeStartError(leaf)).toEqual({ name: 'NotFoundError', message: 'private diagnostic text', frames: expect.any(Array), micAcquisition: true });
        expect(isMicAcquisitionError(toSanitizedCause(leaf))).toBe(true);
        expect(sanitizeStartError(named('NotFoundError'))).not.toHaveProperty('micAcquisition');
        expect(isMicAcquisitionError(toSanitizedCause(named('NotFoundError')))).toBe(false);
    });

    it('leaves a frozen or primitive value as it is', () => {
        const frozen = Object.freeze(named('NotReadableError'));
        expect(markMicAcquisitionError(frozen)).toBe(frozen);
        expect(isMicAcquisitionError(frozen)).toBe(false);
        expect(markMicAcquisitionError('x')).toBe('x');
    });
});
