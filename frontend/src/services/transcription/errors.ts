/**
 * Industry Pattern: Typed Exception Hierarchy
 * Reference: Clean Architecture - Robert C. Martin
 * 
 * Separates EXPECTED EVENTS from UNEXPECTED FAILURES
 */

/**
 * Base class for all transcription-related exceptions
 */
export class TranscriptionError extends Error {
    constructor(
        message: string,
        public readonly code: string
    ) {
        super(message);
        this.name = 'TranscriptionError';
    }
}

/**
 * EXPECTED EVENTS - Do NOT call onError for these
 * These are known, predictable control flow events
 */
export class TranscriptionEvent extends TranscriptionError {
    readonly isExpectedEvent = true;
}

export class CacheMissEvent extends TranscriptionEvent {
    constructor() {
        super('Model not in cache - download required', 'CACHE_MISS');
        this.name = 'CacheMissEvent';
    }
}

export class ModelLoadingEvent extends TranscriptionEvent {
    constructor() {
        super('Model is loading', 'MODEL_LOADING');
        this.name = 'ModelLoadingEvent';
    }
}

/**
 * UNEXPECTED FAILURES - DO call onError for these
 * These are genuine failures requiring user feedback
 */
export class TranscriptionFailure extends TranscriptionError {
    readonly isExpectedEvent = false;
}

export class MicrophoneError extends TranscriptionFailure {
    constructor(reason: string) {
        super(`Microphone error: ${reason}`, 'MIC_ERROR');
        this.name = 'MicrophoneError';
    }
}

export class NetworkError extends TranscriptionFailure {
    constructor(reason: string) {
        super(`Network error: ${reason}`, 'NETWORK_ERROR');
        this.name = 'NetworkError';
    }
}

export class EngineFailure extends TranscriptionFailure {
    constructor(engine: string, reason: string) {
        super(`Engine ${engine} failed: ${reason}`, 'ENGINE_FAILURE');
        this.name = 'EngineFailure';
    }
}

/**
 * Type guard: Is this an expected event (not an error)?
 */
export function isExpectedEvent(error: unknown): error is TranscriptionEvent {
    return (
        error instanceof TranscriptionEvent ||
        (error instanceof Error && 'isExpectedEvent' in error && (error as unknown as Record<string, unknown>).isExpectedEvent === true)
    );
}

/**
 * Type guard: Is this a genuine failure?
 */
export function isUnexpectedFailure(error: unknown): error is TranscriptionFailure {
    return (
        error instanceof TranscriptionFailure ||
        (error instanceof Error && !isExpectedEvent(error))
    );
}

/**
 * Type guard: Is this specifically a cache miss?
 */
export function isCacheMiss(error: unknown): error is CacheMissEvent {
    return (
        error instanceof CacheMissEvent ||
        (error instanceof Error && (
            error.message.includes('CACHE_MISS') ||
            ((error as unknown as Record<string, unknown>).code === 'CACHE_MISS')
        ))
    );
}
