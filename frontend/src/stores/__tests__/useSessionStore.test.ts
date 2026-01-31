import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../useSessionStore';

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
            expect(state.transcript.partial).toBe('typing...');
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
});
