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

        it('keeps the just-saved transcript visible across post-save internal mode normalization', () => {
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

    // #1089 (adversarial-review current-main gap): republishing the SAME Ready status must NOT bypass the
    // Ready/Idle timer-normalization invariant. The reducer's duplicate-status early return previously ran
    // before the invariant, so a same-status Ready republish preserved a stale elapsedTime/startTime.
    describe('#1089 Ready/Idle timer normalization on same-status republish', () => {
        it('normalizes a stale live timer even when the identical Ready status is republished', () => {
            const ready = { type: 'ready' as const, message: 'Ready to record' };
            useSessionStore.setState({ runtimeState: 'READY', sttStatus: ready, elapsedTime: 9, startTime: 1_000 });
            useSessionStore.getState().setSTTStatus({ ...ready }); // duplicate status, stale timer
            const s = useSessionStore.getState();
            expect(s.elapsedTime).toBe(0);
            expect(s.startTime).toBeNull();
            expect(s.sttStatus.type).toBe('ready');
        });

        it('zeroes ONLY the live timer — completed-session duration, transcript and saved identity survive (Ready projects 00:00)', () => {
            const ready = { type: 'ready' as const, message: 'Ready to record' };
            useSessionStore.setState({
                runtimeState: 'READY', sttStatus: ready, elapsedTime: 303, startTime: 2_000,
                completedSessionDurationSeconds: 303, sessionSaved: true,
                transcript: { transcript: 'completed take transcript', partial: '' },
            });
            useSessionStore.getState().setSTTStatus({ ...ready });
            const s = useSessionStore.getState();
            expect(s.elapsedTime).toBe(0);
            expect(s.startTime).toBeNull();
            expect(s.completedSessionDurationSeconds).toBe(303); // review duration preserved
            expect(s.transcript.transcript).toBe('completed take transcript');
            expect(s.sessionSaved).toBe(true);
        });

        it('never zeroes a LIVE recording (the RECORDING guard wins over normalization)', () => {
            useSessionStore.setState({
                runtimeState: 'RECORDING', sttStatus: { type: 'recording', message: 'Recording active' },
                elapsedTime: 42, startTime: 3_000,
            });
            useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready' });
            const s = useSessionStore.getState();
            expect(s.elapsedTime).toBe(42);
            expect(s.startTime).toBe(3_000);
            expect(s.sttStatus.type).toBe('recording');
        });
    });

    // setSTTMode preserves a just-saved transcript across internal normalization and resets an unsaved
    // visible session on a normal mode switch.
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

        it('preserves a just-saved transcript on post-save normalization', () => {
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

    /**
     * #1089 REGRESSION — "Ready to record" displayed alongside a stale 00:09 timer.
     *
     * The visible timer was only ever cleared inside setSTTMode, and that reset is skipped once
     * sessionSaved is true (#772 keeps a just-saved transcript visible). So a previous take's elapsed
     * value survived into the Ready surface. Ready asserts no recording is in progress, so a non-zero
     * timer next to it is a contradiction the user reads as "I am still recording".
     */
    describe('#1089 Ready implies a zeroed timer', () => {
        beforeEach(() => {
            useSessionStore.getState().resetSession();
        });

        it('clears a stale elapsed timer when the status becomes Ready', () => {
            useSessionStore.setState({
                elapsedTime: 9,
                startTime: Date.now() - 9000,
                sessionSaved: true,
                runtimeState: 'READY',
                sttStatus: { type: 'info', message: 'Saving…' },
            });

            useSessionStore.getState().setSTTStatus({ type: 'ready', message: 'Ready to record' });

            const state = useSessionStore.getState();
            expect(state.sttStatus.message).toBe('Ready to record');
            expect(state.elapsedTime).toBe(0);
            expect(state.startTime).toBeNull();
        });

        it('clears the timer on the idle route into Ready as well', () => {
            useSessionStore.setState({
                elapsedTime: 42,
                startTime: Date.now() - 42000,
                runtimeState: 'IDLE',
                sttStatus: { type: 'info', message: 'Saving…' },
            });

            useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Idle' });

            expect(useSessionStore.getState().elapsedTime).toBe(0);
        });

        /**
         * Exercises the NEW `runtimeState !== 'RECORDING'` clause specifically. The obvious case
         * (sttStatus already 'recording') is swallowed by the PRE-EXISTING guard above it, so it
         * proves nothing about this change. Starting from an 'info' status — the real state during
         * the last 20s of the cap warning — reaches the new clause with a live recording underneath.
         */
        it('NEVER zeroes the timer of a live recording (reaches the new runtimeState clause)', () => {
            useSessionStore.setState({
                elapsedTime: 585,
                startTime: Date.now() - 585000,
                runtimeState: 'RECORDING',
                sttStatus: { type: 'info', message: '15s left — Private recordings are capped…' },
            });

            useSessionStore.getState().setSTTStatus({ type: 'ready', message: 'Ready to record' });

            expect(useSessionStore.getState().elapsedTime).toBe(585);
            expect(useSessionStore.getState().startTime).not.toBeNull();
        });

        /**
         * #1089 review finding: `transition()` sets status 'idle' BEFORE runtimeState leaves
         * 'STOPPING', so the zeroing branch runs on EVERY normal stop — not only on a stale-Ready
         * surface. Zeroing the live timer there is correct; silently taking the completed session's
         * duration with it is not, because WPM, pace and the coaching score all divide by it.
         */
        it('preserves the completed-session duration snapshot while zeroing the live timer', () => {
            useSessionStore.getState().setCompletedSessionDuration(303);
            useSessionStore.setState({
                elapsedTime: 303,
                startTime: Date.now() - 303000,
                runtimeState: 'STOPPING',
                sttStatus: { type: 'info', message: 'Processing speech locally…' },
            });

            useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready to record' });

            const state = useSessionStore.getState();
            expect(state.elapsedTime).toBe(0);                          // visible timer resets
            expect(state.completedSessionDurationSeconds).toBe(303);    // review keeps the real length
        });
    });
});
