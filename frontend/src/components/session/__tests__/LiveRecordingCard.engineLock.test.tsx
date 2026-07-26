import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveRecordingCard } from '../LiveRecordingCard';
import { TEST_IDS } from '@/constants/testIds';

// #1033 Part-2b (A1/A2): the selector must consume the AUTHORITATIVE controller lock, which is broader
// than `isListening`, and must explain truthfully what unlocks it.
const base = {
    mode: 'private' as const,
    isListening: false,
    isReady: true,
    isPaused: false,
    fsmState: 'READY' as const,
    sttStatusType: 'ready' as const,
    privateModelStatus: 'ready' as const,
    recordingIntent: false,
    isFinalizing: false,
    canUsePrivate: true,
    isPaidProUser: true,
    canUseCloudStt: true,
    activeEngine: 'private' as const,
    formattedTime: '00:00',
    elapsedSeconds: 0,
    isButtonDisabled: false,
    onModeChange: vi.fn(),
    onStartStop: vi.fn(),
    onDownloadModel: vi.fn(),
};

const trigger = () => screen.getByTestId(TEST_IDS.STT_MODE_SELECT);

describe('#1033 Part-2b: selector consumes the authoritative engine-selection lock', () => {
    it('is ENABLED when nothing is locked', () => {
        render(<LiveRecordingCard {...base} />);
        expect(trigger()).not.toBeDisabled();
        expect(trigger()).toHaveAttribute('data-locked', 'false');
    });

    it('is DISABLED while the controller reports the lock even though isListening is false', () => {
        // This is the case the old `isListening`-only gate missed entirely: Start intent, or a
        // started-but-unresolved recording, with no active listening.
        render(<LiveRecordingCard {...base} isListening={false} engineSelectionLocked />);
        expect(trigger()).toBeDisabled();
        expect(trigger()).toHaveAttribute('data-locked', 'true');
    });

    it.each([
        { kind: 'full_save' as const, copy: /save or discard your unsaved recording/i },
        { kind: 'initial_save' as const, copy: /save or discard your unsaved recording/i },
        { kind: 'attribution' as const, copy: /finish saving your last recording/i },
    ])('states truthfully WHY it is locked for $kind', ({ kind, copy }) => {
        render(<LiveRecordingCard {...base} engineSelectionLocked pendingResolutionKind={kind} />);
        expect(trigger()).toHaveAttribute('title', expect.stringMatching(copy));
    });

    it('says "stop recording" only when actually recording', () => {
        render(<LiveRecordingCard {...base} isListening engineSelectionLocked />);
        expect(trigger()).toHaveAttribute('title', expect.stringMatching(/stop recording/i));
    });

    it('never claims "recording" when the real blocker is an unsaved recording', () => {
        render(<LiveRecordingCard {...base} isListening={false} engineSelectionLocked pendingResolutionKind="full_save" />);
        expect(trigger().getAttribute('title') ?? '').not.toMatch(/stop recording/i);
    });
});
