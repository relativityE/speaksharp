import logger from '../../lib/logger';

export type TranscriptionState =
    | 'IDLE'
    | 'ACTIVATING_MIC'
    | 'READY'
    | 'DOWNLOADING_MODEL'
    | 'INITIALIZING_ENGINE'
    | 'RECORDING'
    | 'PAUSED'
    | 'STOPPING'
    | 'CLEANING_UP'
    | 'ERROR'
    | 'TERMINATED';

export type TranscriptionEvent =
    | { type: 'START_REQUESTED' }
    | { type: 'MIC_ACQUIRED' }
    | { type: 'ENGINE_INIT_REQUESTED' }
    | { type: 'DOWNLOAD_STARTED' }
    | { type: 'ENGINE_STARTED' }
    | { type: 'PAUSE_REQUESTED' }
    | { type: 'RESUME_REQUESTED' }
    | { type: 'STOP_REQUESTED' }
    | { type: 'STOP_COMPLETED' }
    | { type: 'RESET_REQUESTED' }
    | { type: 'ERROR_OCCURRED'; error: Error }
    | { type: 'TERMINATE_REQUESTED' };

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

    // START sequence: IDLE -> ACTIVATING_MIC -> READY -> INITIALIZING_ENGINE -> RECORDING
    private readonly transitions: StateTransition[] = [
        { from: 'IDLE', to: 'ACTIVATING_MIC', event: 'START_REQUESTED' },
        { from: 'ERROR', to: 'ACTIVATING_MIC', event: 'START_REQUESTED' }, // Retry from error

        { from: 'ACTIVATING_MIC', to: 'READY', event: 'MIC_ACQUIRED' },

        { from: 'READY', to: 'INITIALIZING_ENGINE', event: 'ENGINE_INIT_REQUESTED' },
        { from: 'INITIALIZING_ENGINE', to: 'DOWNLOADING_MODEL', event: 'DOWNLOAD_STARTED' },
        { from: 'DOWNLOADING_MODEL', to: 'INITIALIZING_ENGINE', event: 'ENGINE_INIT_REQUESTED' },

        { from: 'INITIALIZING_ENGINE', to: 'RECORDING', event: 'ENGINE_STARTED' },
        { from: 'DOWNLOADING_MODEL', to: 'RECORDING', event: 'ENGINE_STARTED' },

        { from: 'RECORDING', to: 'PAUSED', event: 'PAUSE_REQUESTED' },
        { from: 'PAUSED', to: 'RECORDING', event: 'RESUME_REQUESTED' },

        { from: 'RECORDING', to: 'STOPPING', event: 'STOP_REQUESTED' },
        { from: 'PAUSED', to: 'STOPPING', event: 'STOP_REQUESTED' }, // Can stop while paused

        { from: 'STOPPING', to: 'READY', event: 'STOP_COMPLETED' }, // Keep mic hot
        { from: 'STOPPING', to: 'IDLE', event: 'RESET_REQUESTED' },

        // Terminal & Cleanup Sequence
        { from: 'IDLE', to: 'TERMINATED', event: 'TERMINATE_REQUESTED' },
        { from: 'ERROR', to: 'TERMINATED', event: 'TERMINATE_REQUESTED' },
        { from: 'RECORDING', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'PAUSED', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'STOPPING', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'ACTIVATING_MIC', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'INITIALIZING_ENGINE', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'DOWNLOADING_MODEL', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },
        { from: 'READY', to: 'CLEANING_UP', event: 'TERMINATE_REQUESTED' },

        // Finalize cleanup - Strict outbound transitions per Senior Audit
        { from: 'CLEANING_UP', to: 'IDLE', event: 'RESET_REQUESTED' },
        { from: 'CLEANING_UP', to: 'ERROR', event: 'ERROR_OCCURRED' },

        // Global Error Transitions
        { from: 'IDLE', to: 'ERROR', event: 'ERROR_OCCURRED' },
        { from: 'ACTIVATING_MIC', to: 'ERROR', event: 'ERROR_OCCURRED' },
        { from: 'READY', to: 'ERROR', event: 'ERROR_OCCURRED' },
        { from: 'DOWNLOADING_MODEL', to: 'ERROR', event: 'ERROR_OCCURRED' },
        { from: 'INITIALIZING_ENGINE', to: 'ERROR', event: 'ERROR_OCCURRED' },
        { from: 'RECORDING', to: 'ERROR', event: 'ERROR_OCCURRED' },
        { from: 'PAUSED', to: 'ERROR', event: 'ERROR_OCCURRED' },
        { from: 'STOPPING', to: 'ERROR', event: 'ERROR_OCCURRED' },

        // Reset from Terminal
        { from: 'TERMINATED', to: 'IDLE', event: 'RESET_REQUESTED' },
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
            event: event.type
        }, `[FSM] State transition: ${previousState} -> ${this.currentState}`);

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
