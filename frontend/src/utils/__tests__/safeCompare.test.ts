import { describe, it, expect } from 'vitest';
import { safeCompare } from '../safeCompare';

describe('safeCompare', () => {
    it('should return true for identical strings', async () => {
        const secret = 'super-secret-key-123';
        const input = 'super-secret-key-123';
        expect(await safeCompare(secret, input)).toBe(true);
    });

    it('should return false for different strings of same length', async () => {
        const secret = 'super-secret-key-123';
        const input = 'super-secret-key-124'; // Differs at last char
        expect(await safeCompare(secret, input)).toBe(false);
    });

    it('should return false for strings of different lengths', async () => {
        const secret = 'super-secret-key-123';
        const input = 'super-secret-key';
        expect(await safeCompare(secret, input)).toBe(false);
    });

    it('should return false for empty string comparison against non-empty', async () => {
        const secret = 'secret';
        const input = '';
        expect(await safeCompare(secret, input)).toBe(false);
    });

    it('should return true for two empty strings', async () => {
        expect(await safeCompare('', '')).toBe(true);
    });

    it('should handle unicode characters correctly', async () => {
        const secret = '🔒🔑';
        const input = '🔒🔑';
        const wrong = '🔒🔓';
        expect(await safeCompare(secret, input)).toBe(true);
        expect(await safeCompare(secret, wrong)).toBe(false);
    });
});
