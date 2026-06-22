import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';

/**
 * useSessionStore Behavioral Tests
 * 
 * These tests verify STATE INVARIANTS, not implementation details.
 * Each test validates that actions produce correct state transitions.
 * 
 * Primary Risk Mitigated: State corruption in recording flow
 */

describe('useSessionStore', () => {
    beforeEach(() => {
        // Reset store to initial state before each test
        useSessionStore.setState({
            isListening: false,
            isReady: false,
            transcript: { transcript: '', partial: '' },
            fillerData: {},
            elapsedTime: 0,
            startTime: null,
            frozenTranscriptAtStop: null,
            isTranscriptFinalizing: false,
        });
    });

    describe('startSession', () => {
        it('sets isListening to true and records startTime', () => {
            const before = Date.now();
            useSessionStore.getState().startSession();
            const after = Date.now();

            const state = useSessionStore.getState();
            expect(state.isListening).toBe(true);
            expect(state.startTime).toBeGreaterThanOrEqual(before);
            expect(state.startTime).toBeLessThanOrEqual(after);
        });
    });

    describe('runtime recording truth', () => {
        it('does not mark pre-recording startup states as active listening', () => {
            useSessionStore.getState().setRuntimeState('INITIATING');
            expect(useSessionStore.getState().isListening).toBe(false);
            expect(useSessionStore.getState().startTime).toBeNull();

            useSessionStore.getState().setRuntimeState('ENGINE_INITIALIZING');
            expect(useSessionStore.getState().isListening).toBe(false);
            expect(useSessionStore.getState().startTime).toBeNull();
        });

        it('marks only confirmed RECORDING as active listening', () => {
            useSessionStore.getState().setRuntimeState('RECORDING');

            expect(useSessionStore.getState().isListening).toBe(true);
        });
    });

    describe('stopSession', () => {
        it('sets isListening to false and clears startTime', () => {
            // Arrange: start a session first
            useSessionStore.getState().startSession();
            expect(useSessionStore.getState().isListening).toBe(true);

            // Act
            useSessionStore.getState().stopSession();

            // Assert
            const state = useSessionStore.getState();
            expect(state.isListening).toBe(false);
            expect(state.startTime).toBeNull();
        });

        it('preserves elapsedTime after stopping (for summary display)', () => {
            // Arrange
            useSessionStore.getState().startSession();
            useSessionStore.getState().updateElapsedTime(120);

            // Act
            useSessionStore.getState().stopSession();

            // Assert: elapsedTime NOT reset (per P1 FIX comment in source)
            expect(useSessionStore.getState().elapsedTime).toBe(120);
        });
    });

    describe('setReady', () => {
        it('sets isReady to true', () => {
            useSessionStore.getState().setReady(true);
            expect(useSessionStore.getState().isReady).toBe(true);
        });

        it('sets isReady to false', () => {
            useSessionStore.setState({ isReady: true });
            useSessionStore.getState().setReady(false);
            expect(useSessionStore.getState().isReady).toBe(false);
        });
    });

    describe('updateTranscript', () => {
        it('updates transcript with provided text', () => {
            useSessionStore.getState().updateTranscript('Hello world');

            const state = useSessionStore.getState();
            expect(state.transcript.transcript).toBe('Hello world');
            expect(state.transcript.partial).toBe('');
        });

        it('updates transcript with partial text', () => {
            useSessionStore.getState().updateTranscript('Complete text', 'typing...');

            const state = useSessionStore.getState();
            expect(state.transcript.transcript).toBe('Complete text');
            expect(state.transcript.partial).toBe('Typing...');
        });
    });

    describe('setSTTMode', () => {
        it('does not clear visible transcript while stop finalization is preserving it', () => {
            useSessionStore.getState().updateTranscript('Already committed', 'still speaking');
            useSessionStore.getState().setTranscriptFinalizing(true);
            useSessionStore.getState().freezeTranscriptAtStop('Already committed still speaking');

            useSessionStore.getState().setSTTMode('private');

            expect(useSessionStore.getState().transcript).toEqual({
                transcript: 'Already committed',
                partial: 'Still speaking',
            });
            expect(useSessionStore.getState().frozenTranscriptAtStop).toBe('Already committed still speaking');
        });

        it('keeps the just-saved transcript visible when a Private sample auto-save forces a Browser fallback switch', () => {
            // When a first-time Private sample auto-ends and saves, the app force-switches the
            // mode to native/browser. The transcript the tester just recorded must stay visible
            // on the session page (it is saved + correct in Analytics) until the next recording.
            useSessionStore.setState({
                runtimeState: 'READY',
                sttMode: 'private',
                sessionSaved: true,
                transcript: { transcript: 'We should literally like, wait, um, basically.', partial: '' },
                isTranscriptFinalizing: false,
                frozenTranscriptAtStop: null,
            });

            useSessionStore.getState().setSTTMode('native');

            const state = useSessionStore.getState();
            expect(state.sttMode).toBe('native');
            expect(state.transcript).toEqual({
                transcript: 'We should literally like, wait, um, basically.',
                partial: '',
            });
            expect(state.sessionSaved).toBe(true);
        });

        it('still clears the visible session on an ordinary mode switch before a session is saved', () => {
            // No save has happened yet: switching modes should reset the in-progress draft as before.
            useSessionStore.setState({
                runtimeState: 'READY',
                sttMode: 'native',
                sessionSaved: false,
                transcript: { transcript: 'unsaved draft text', partial: 'still going' },
                isTranscriptFinalizing: false,
                frozenTranscriptAtStop: null,
            });

            useSessionStore.getState().setSTTMode('private');

            const state = useSessionStore.getState();
            expect(state.sttMode).toBe('private');
            expect(state.transcript).toEqual({ transcript: '', partial: '' });
        });
    });

    describe('updateFillerData', () => {
        it('updates filler word counts', () => {
            const fillerData = {
                um: { count: 3, color: '#ff0000' },
                uh: { count: 2, color: '#00ff00' },
                like: { count: 5, color: '#0000ff' }
            };
            useSessionStore.getState().updateFillerData(fillerData);

            expect(useSessionStore.getState().fillerData).toEqual(fillerData);
        });
    });

    describe('updateElapsedTime', () => {
        it('updates elapsed time value', () => {
            useSessionStore.getState().updateElapsedTime(45);
            expect(useSessionStore.getState().elapsedTime).toBe(45);

            useSessionStore.getState().updateElapsedTime(90);
            expect(useSessionStore.getState().elapsedTime).toBe(90);
        });
    });

    describe('resetSession', () => {
        it('returns all state to initial values', () => {
            // Arrange: set up dirty state
            useSessionStore.setState({
                isListening: true,
                isReady: true,
                transcript: { transcript: 'Some text', partial: 'more' },
                fillerData: { um: { count: 5, color: '#ff0000' } },
                elapsedTime: 300,
                startTime: Date.now(),
            });

            // Act
            useSessionStore.getState().resetSession();

            // Assert: all values back to initial
            const state = useSessionStore.getState();
            expect(state.isListening).toBe(false);
            expect(state.isReady).toBe(false);
            expect(state.transcript).toEqual({ transcript: '', partial: '' });
            expect(state.fillerData).toEqual({});
            expect(state.elapsedTime).toBe(0);
            expect(state.startTime).toBeNull();
        });
    });

    describe('setSTTStatus guard', () => {
        it('allows error status to replace recording status', () => {
            useSessionStore.getState().setSTTStatus({ type: 'recording', message: 'Recording active' });
            useSessionStore.getState().setSTTStatus({ type: 'error', message: 'Mic failed' });
            expect(useSessionStore.getState().sttStatus.type).toBe('error');
        });

        it('blocks idle from replacing recording status when still recording', () => {
            useSessionStore.getState().setRuntimeState('RECORDING');
            useSessionStore.getState().setSTTStatus({ type: 'recording', message: 'Recording active' });
            useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready' });
            expect(useSessionStore.getState().sttStatus.type).toBe('recording');
        });

        it('allows idle to replace recording status when runtimeState is NOT RECORDING', () => {
            useSessionStore.getState().setRuntimeState('FAILED');
            useSessionStore.getState().setSTTStatus({ type: 'recording', message: 'Recording active' });
            useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready' });
            expect(useSessionStore.getState().sttStatus.type).toBe('idle');
        });
    });

    // PR 1a / #772 regression guard: setSTTMode's GLOBAL behavior must stay unchanged. The B fix
    // (clearing a stale transcript on a MANUAL mode switch) lives in the user-initiated setMode
    // handler, NOT in setSTTMode. So setSTTMode must still PRESERVE a just-saved transcript across
    // the automatic post-save force-switch (#772 Private-sample auto-end), and still RESET the
    // visible session on a normal (unsaved) mode switch.
    describe('setSTTMode visible-session reset guard (#772)', () => {
        const seedSavedSession = (sessionSaved: boolean) => {
            useSessionStore.setState({
                sttMode: 'native',
                sessionSaved,
                runtimeState: 'READY',
                isTranscriptFinalizing: false,
                frozenTranscriptAtStop: null,
                transcript: { transcript: 'just saved transcript', partial: '' },
                chunks: [{ transcript: 'just saved transcript', timestamp: 1, isFinal: true }],
            });
        };

        it('PRESERVES a just-saved transcript on a post-save force-switch (sessionSaved=true) — #772 intact', () => {
            seedSavedSession(true);
            useSessionStore.getState().setSTTMode('cloud');
            const state = useSessionStore.getState();
            expect(state.sttMode).toBe('cloud');
            expect(state.transcript.transcript).toBe('just saved transcript');
            expect(state.chunks).toHaveLength(1);
            expect(state.sessionSaved).toBe(true);
        });

        it('RESETS the visible session on a normal (unsaved) mode switch (sessionSaved=false)', () => {
            seedSavedSession(false);
            useSessionStore.getState().setSTTMode('cloud');
            const state = useSessionStore.getState();
            expect(state.sttMode).toBe('cloud');
            expect(state.transcript.transcript).toBe('');
            expect(state.chunks).toHaveLength(0);
        });
    });
});
