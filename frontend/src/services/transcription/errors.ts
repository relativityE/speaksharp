/**
 * Industry Pattern: Typed Exception Hierarchy (Static Factory Pattern)
 * Reference: Clean Architecture - Robert C. Martin
 * 
 * Central Source of Truth for all transcription-related exceptions.
 * Enforces unified error reporting and recovery logic across all strategies.
 */

export type TranscriptionErrorCode = 
    | 'NETWORK' 
    | 'PERMISSION' 
    | 'MODEL_LOAD' 
    | 'WEBSOCKET' 
    | 'UNKNOWN' 
    | 'CACHE_MISS' 
    | 'NO_API_KEY' 
    | 'OFFLINE' 
    | 'PERMISSION_DENIED' 
    | 'UNSUPPORTED'
    | 'MODE_LOCK_VIOLATION'
    | 'ENGINE_FAILURE'
    | 'MIC_ERROR';

export class TranscriptionError extends Error {
    readonly isExpectedEvent: boolean;

    private constructor(
        message: string,
        public readonly code: TranscriptionErrorCode,
        public readonly recoverable: boolean = true,
        isExpected: boolean = false
    ) {
        super(message);
        this.name = 'TranscriptionError';
        this.isExpectedEvent = isExpected;
    }

    // --- STATIC FACTORY METHODS (The ONLY way to create errors) ---

    static network(reason: string, recoverable = true): TranscriptionError {
        return new TranscriptionError(`Network error: ${reason}`, 'NETWORK', recoverable);
    }

    static permission(reason: string): TranscriptionError {
        return new TranscriptionError(`Permission denied: ${reason}`, 'PERMISSION', false);
    }

    static modelLoad(reason: string): TranscriptionError {
        return new TranscriptionError(`Model load error: ${reason}`, 'MODEL_LOAD', true);
    }

    static websocket(reason: string, recoverable = true): TranscriptionError {
        return new TranscriptionError(`WebSocket error: ${reason}`, 'WEBSOCKET', recoverable);
    }

    static cacheMiss(): TranscriptionError {
        return new TranscriptionError('Model not in cache - download required', 'CACHE_MISS', true, true);
    }

    static modeLocked(active: string, requested: string): TranscriptionError {
        return new TranscriptionError(
            `Security Violation: Cannot switch to ${requested} while session is locked to ${active}`, 
            'MODE_LOCK_VIOLATION', 
            false
        );
    }

    static engineFailure(engine: string, reason: string, recoverable = true): TranscriptionError {
        return new TranscriptionError(`Engine ${engine} failed: ${reason}`, 'ENGINE_FAILURE', recoverable);
    }

    static microphone(reason: string): TranscriptionError {
        return new TranscriptionError(`Microphone error: ${reason}`, 'MIC_ERROR', false);
    }

    static unknown(reason: string): TranscriptionError {
        return new TranscriptionError(`An unknown error occurred: ${reason}`, 'UNKNOWN', true);
    }
}

/**
 * Type guard: Is this an expected event (not an error)?
 */
export function isExpectedEvent(error: unknown): error is TranscriptionError {
    return (
        error instanceof TranscriptionError && error.isExpectedEvent === true
    );
}

/**
 * Type guard: Is this a genuine failure?
 */
export function isUnexpectedFailure(error: unknown): error is TranscriptionError {
    return (
        error instanceof TranscriptionError && error.isExpectedEvent === false
    );
}

/**
 * Type guard: Is this specifically a cache miss?
 */
export function isCacheMiss(error: unknown): error is TranscriptionError {
    return (
        error instanceof TranscriptionError && error.code === 'CACHE_MISS'
    );
}
