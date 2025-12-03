import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cn, getSyncSession } from '../utils';

describe('utils.ts', () => {
    describe('cn', () => {
        it('should merge class names correctly', () => {
            const result = cn('text-red-500', 'bg-blue-500');
            expect(result).toBe('text-red-500 bg-blue-500');
        });

        it('should handle conditional classes', () => {
            const isFalse = false;
            const result = cn('text-red-500', isFalse && 'bg-blue-500', 'font-bold');
            expect(result).toBe('text-red-500 font-bold');
        });

        it('should merge tailwind classes correctly (override)', () => {
            const result = cn('p-4', 'p-8');
            expect(result).toBe('p-8');
        });
    });

    describe('getSyncSession', () => {
        beforeEach(() => {
            localStorage.clear();
            vi.spyOn(console, 'error').mockImplementation(() => { });
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should return null if no session key found', () => {
            const session = getSyncSession();
            expect(session).toBeNull();
        });

        it('should return null if session data is empty', () => {
            localStorage.setItem('sb-test-auth-token', '');
            const session = getSyncSession();
            expect(session).toBeNull();
        });

        it('should return session if valid session data found', () => {
            const mockSession = {
                access_token: 'token',
                user: { id: 'user1' },
            };
            localStorage.setItem('sb-test-auth-token', JSON.stringify(mockSession));

            const session = getSyncSession();
            expect(session).toEqual(mockSession);
        });

        it('should return null if session data is invalid (missing token)', () => {
            const mockSession = {
                user: { id: 'user1' },
            };
            localStorage.setItem('sb-test-auth-token', JSON.stringify(mockSession));

            const session = getSyncSession();
            expect(session).toBeNull();
        });

        it('should return null and log error if parsing fails', () => {
            localStorage.setItem('sb-test-auth-token', 'invalid-json');

            const session = getSyncSession();
            expect(session).toBeNull();
            expect(console.error).toHaveBeenCalled();
        });
    });
});
