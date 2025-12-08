import { describe, it, expect } from 'vitest';
import { TranscriptionError } from '../modes/types';

describe('TranscriptionError', () => {
    describe('constructor', () => {
        it('should create error with correct properties', () => {
            const error = new TranscriptionError('Test error', 'NETWORK', true);

            expect(error.message).toBe('Test error');
            expect(error.code).toBe('NETWORK');
            expect(error.recoverable).toBe(true);
            expect(error.name).toBe('TranscriptionError');
        });

        it('should extend Error class', () => {
            const error = new TranscriptionError('Test', 'UNKNOWN', false);
            expect(error).toBeInstanceOf(Error);
        });
    });

    describe('factory methods', () => {
        it('should create network error', () => {
            const error = TranscriptionError.network('Connection lost');

            expect(error.code).toBe('NETWORK');
            expect(error.message).toBe('Connection lost');
            expect(error.recoverable).toBe(true); // default
        });

        it('should create non-recoverable network error', () => {
            const error = TranscriptionError.network('Fatal error', false);
            expect(error.recoverable).toBe(false);
        });

        it('should create permission error', () => {
            const error = TranscriptionError.permission('Mic access denied');

            expect(error.code).toBe('PERMISSION');
            expect(error.message).toBe('Mic access denied');
            expect(error.recoverable).toBe(false); // always false
        });

        it('should create model load error', () => {
            const error = TranscriptionError.modelLoad('Model download failed');

            expect(error.code).toBe('MODEL_LOAD');
            expect(error.message).toBe('Model download failed');
            expect(error.recoverable).toBe(true); // default
        });

        it('should create websocket error', () => {
            const error = TranscriptionError.websocket('WS disconnected');

            expect(error.code).toBe('WEBSOCKET');
            expect(error.message).toBe('WS disconnected');
            expect(error.recoverable).toBe(true); // default
        });

        it('should create non-recoverable websocket error', () => {
            const error = TranscriptionError.websocket('Max retries', false);
            expect(error.recoverable).toBe(false);
        });
    });

    describe('error codes', () => {
        it('should accept all valid codes', () => {
            const codes: Array<'NETWORK' | 'PERMISSION' | 'MODEL_LOAD' | 'WEBSOCKET' | 'UNKNOWN'> = [
                'NETWORK',
                'PERMISSION',
                'MODEL_LOAD',
                'WEBSOCKET',
                'UNKNOWN'
            ];

            codes.forEach(code => {
                const error = new TranscriptionError('Test', code, false);
                expect(error.code).toBe(code);
            });
        });
    });
});
