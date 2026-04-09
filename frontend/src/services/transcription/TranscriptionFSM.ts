import logger from '../../lib/logger';
import { TranscriptionPolicy } from './TranscriptionPolicy';

export type TranscriptionState =
    | 'IDLE'
    | 'ACTIVATING_MIC'
    | 'READY'
    | 'ENGINE_INITIALIZING'
    | 'RECORDING'
    | 'PAUSED'
    | 'STOPPING'
    | 'CLEANING_UP'
    | 'DOWNLOAD_REQUIRED'
    | 'FAILED'
    | 'TERMINATED';

export type TranscriptionEvent =
    | { type: 'START_REQUESTED' }
    | { type: 'MIC_ACQUIRED' }
    | { type: 'ENGINE_INIT_REQUESTED' }
    | { type: 'ENGINE_INIT_SUCCESS' }
    | { type: 'ENGINE_STARTED' }
    | { type: 'PAUSE_REQUESTED' }
    | { type: 'PAUSE_COMPLETED' }
    | { type: 'RESUME_REQUESTED' }
    | { type: 'RESUME_COMPLETED' }
    | { type: 'STOP_REQUESTED' }
    | { type: 'STOP_COMPLETED' }
    | { type: 'RESET_REQUESTED' }
    | { type: 'ERROR_OCCURRED'; error: Error }
    | { type: 'DOWNLOAD_REQUIRED' }
    | { type: 'TERMINATE_REQUESTED' }
    | { type: 'TERMINATE_COMPLETED' }
    | { type: 'POLICY_UPDATED'; policy: TranscriptionPolicy };

interface StateTransition {
    from: TranscriptionState;
    to: TranscriptionState;
    event: TranscriptionEvent['type'];
}

/**
 * Finite State Machine for Transcription Service.
 * strict handling of valid state transitions to prevent indeterminate states.
 */
export class TranscriptionFSM {
    private currentState: TranscriptionState = 'IDLE';
    private listeners = new Set<(state: TranscriptionState) => void>();

    // START sequence: IDLE -> ACTIVATING_MIC -> READY -> ENGINE_INITIALIZING -> RECORDING
    private readonly transitions: StateTransition[] = [
        { from: 'IDLE', to: 'ACTIVATING_MIC', event: 'START_REQUESTED' },
        { from: 'FAILED', to: 'ACTIVATING_MIC', event: 'START_REQUESTED' }, // Retry from error

        { from: 'ACTIVATING_MIC', to: 'READY', event: 'MIC_ACQUIRED' },

        { from: 'IDLE', to: 'ENGINE_INITIALIZING', event: 'ENGINE_INIT_REQUESTED' }, // Allow direct init from idle
        { from: 'READY', to: 'ENGINE_INITIALIZING', event: 'ENGINE_INIT_REQUESTED' },
        { from: 'ENGINE_INITIALIZING', to: 'ENGINE_INITIALIZING', event: 'ENGINE_INIT_REQUESTED' }, // Allow re-init/fallback
        { from: 'FAILED', to: 'ENGINE_INITIALIZING', event: 'ENGINE_INIT_REQUESTED' }, // Allow fallback/retry

        { from: 'ENGINE_INITIALIZING', to: 'READY', event: 'ENGINE_INIT_SUCCESS' },
        { from: 'READY', to: 'RECORDING', event: 'ENGINE_STARTED' },
        { from: 'ENGINE_INITIALIZING', to: 'RECORDING', event: 'ENGINE_STARTED' },
        { from: 'ENGINE_INITIALIZING', to: 'IDLE', event: 'STOP_REQUESTED' },
        { from: 'ENGINE_INITIALIZING', to: 'IDLE', event: 'RESET_REQUESTED' },
        { from: 'ENGINE_INITIALIZING', to: 'DOWNLOAD_REQUIRED', event: 'DOWNLOAD_REQUIRED' },
        { from: 'READY', to: 'DOWNLOAD_REQUIRED', event: 'DOWNLOAD_REQUIRED' }, // Allow download required from ready

        { from: 'DOWNLOAD_REQUIRED', to: 'IDLE', event: 'RESET_REQUESTED' },
        { from: 'DOWNLOAD_REQUIRED', to: 'ENGINE_INITIALIZING', event: 'ENGINE_INIT_REQUESTED' },
        { from: 'DOWNLOAD_REQUIRED', to: 'FAILED', event: 'ERROR_OCCURRED' },

        { from: 'RECORDING', to: 'PAUSED', event: 'PAUSE_REQUESTED' },
        { from: 'PAUSED', to: 'PAUSED', event: 'PAUSE_COMPLETED' }, // Settlement
        { from: 'PAUSED', to: 'RECORDING', event: 'RESUME_REQUESTED' },
        { from: 'RECORDING', to: 'RECORDING', event: 'RESUME_COMPLETED' }, // Settlement

        { from: 'RECORDING', to: 'STOPPING', event: 'STOP_REQUESTED' },
        { from: 'PAUSED', to: 'STOPPING', event: 'STOP_REQUESTED' }, // Can stop while paused

        { from: 'STOPPING', to: 'READY', event: 'STOP_COMPLETED' }, // Keep mic hot
        { from: 'STOPPING', to: 'IDLE', event: 'RESET_REQUESTED' },

        // Error Transition Map (Generic handling)
        { from: 'IDLE', to: 'FAILED', event: 'ERROR_OCCURRED' },
        { from: 'ACTIVATING_MIC', to: 'FAILED', event: 'ERROR_OCCURRED' },
        { from: 'READY', to: 'FAILED', event: 'ERROR_OCCURRED' },
        { from: 'ENGINE_INITIALIZING', to: 'FAILED', event: 'ERROR_OCCURRED' },
        { from: 'RECORDING', to: 'FAILED', event: 'ERROR_OCCURRED' },
        { from: 'PAUSED', to: 'FAILED', event: 'ERROR_OCCURRED' },
        { from: 'STOPPING', to: 'FAILED', event: 'ERROR_OCCURRED' },

        // Terminal & Cleanup Sequence
        { from: 'IDLE', to: 'TERMINATED', event: 'TERMINATE_REQUESTED' },
        { from: 'FAILED', to: 'TERMINATED', event: 'TERMINATE_REQUESTED' },
        { from: 'RECORDING', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'PAUSED', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'STOPPING', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'ACTIVATING_MIC', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'ENGINE_INITIALIZING', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'READY', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'CLEANING_UP', to: 'TERMINATED', event: 'TERMINATE_COMPLETED' },

        // Finalize cleanup - Strict outbound transitions per Senior Audit
        { from: 'CLEANING_UP', to: 'FAILED', event: 'ERROR_OCCURRED' },

        // Reset from Terminal or Failed
        { from: 'TERMINATED', to: 'IDLE', event: 'RESET_REQUESTED' },
        { from: 'FAILED', to: 'IDLE', event: 'RESET_REQUESTED' },

        // Dynamic Policy Updates (re-evaluates current state)
        { from: 'IDLE', to: 'IDLE', event: 'POLICY_UPDATED' },
        { from: 'READY', to: 'READY', event: 'POLICY_UPDATED' },
        { from: 'RECORDING', to: 'RECORDING', event: 'POLICY_UPDATED' },
        { from: 'PAUSED', to: 'PAUSED', event: 'POLICY_UPDATED' },
        { from: 'FAILED', to: 'FAILED', event: 'POLICY_UPDATED' },
    ];

    constructor(initialState: TranscriptionState = 'IDLE') {
        this.currentState = initialState;
    }

    /**
     * Transition to new state
     */
    transition(event: TranscriptionEvent): boolean {
        const validTransition = this.transitions.find(
            t => t.from === this.currentState && t.event === event.type
        );

        if (!validTransition) {
            logger.warn({
                from: this.currentState,
                event: event.type
            }, '[FSM] Invalid transition attempt');
            return false;
        }

        const previousState = this.currentState;
        this.currentState = validTransition.to;

        logger.info({
            from: previousState,
            to: this.currentState,
            event: event.type,
            error: 'error' in event ? (event as { error: Error }).error.message : undefined
        }, `[FSM] ⚡ Transition: ${previousState} --(${event.type})--> ${this.currentState}`);

        this.notifyListeners();
        return true;
    }

    /**
     * Force set state (use carefully, mainly for init/reset)
     */
    setState(state: TranscriptionState): void {
        logger.info({ from: this.currentState, to: state }, '[FSM] Forcing state');
        this.currentState = state;
        this.notifyListeners();
    }

    getState(): TranscriptionState {
        return this.currentState;
    }

    /**
     * ✅ EXPERT FIX: Hard reset to IDLE for test isolation.
     */
    reset(): void {
        logger.info({ from: this.currentState, to: 'IDLE' }, '[FSM] Hard reset to IDLE');
        this.currentState = 'IDLE';
        this.notifyListeners();
    }

    is(state: TranscriptionState): boolean {
        return this.currentState === state;
    }

    subscribe(listener: (state: TranscriptionState) => void): () => void {
        this.listeners.add(listener);
        // Initial callback
        listener(this.currentState);
        return () => this.listeners.delete(listener);
    }

    private notifyListeners(): void {
        this.listeners.forEach(l => l(this.currentState));
    }
}
