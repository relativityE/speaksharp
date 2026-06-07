import { describe, expect, it } from 'vitest';
import { buildHolderLabel, interpretAcquireResult, isLeaseRevoked } from '../recordingLeasePolicy';

describe('interpretAcquireResult', () => {
    it('acquired → start (no take-over)', () => {
        expect(interpretAcquireResult({ acquired: true, took_over: false })).toEqual({ action: 'start', tookOver: false });
    });

    it('acquired via force → start with tookOver=true', () => {
        expect(interpretAcquireResult({ acquired: true, took_over: true })).toEqual({ action: 'start', tookOver: true });
    });

    it('held_by_other → blocked with friendly copy naming the holder (default = stay blocked)', () => {
        expect(interpretAcquireResult({ acquired: false, reason: 'held_by_other', holder_label: 'this browser on MacIntel', started_at: '2026-06-07T04:00:00Z' })).toEqual({
            action: 'blocked',
            holderLabel: 'this browser on MacIntel',
            startedAt: '2026-06-07T04:00:00Z',
            message: 'You are already recording on this browser on MacIntel. Stop it there, or take over on this device.',
        });
    });

    it('held_by_other with no label → falls back to "another device"', () => {
        expect(interpretAcquireResult({ acquired: false, reason: 'held_by_other' })).toEqual({
            action: 'blocked',
            holderLabel: 'another device',
            startedAt: null,
            message: 'You are already recording on another device. Stop it there, or take over on this device.',
        });
    });

    it('unauthenticated and unknown reasons → error (never silently starts)', () => {
        expect(interpretAcquireResult({ acquired: false, reason: 'unauthenticated' }).action).toBe('error');
        expect(interpretAcquireResult({ acquired: false }).action).toBe('error');
        expect(interpretAcquireResult(null).action).toBe('error');
        expect(interpretAcquireResult(undefined).action).toBe('error');
    });
});

describe('isLeaseRevoked', () => {
    it('true only when the server says valid=false (revoked/released)', () => {
        expect(isLeaseRevoked({ valid: false, reason: 'revoked' })).toBe(true);
        expect(isLeaseRevoked({ valid: true })).toBe(false);
    });
    it('a missing/transient response is NOT a revocation (do not interrupt recording on a network blip)', () => {
        expect(isLeaseRevoked(null)).toBe(false);
        expect(isLeaseRevoked(undefined)).toBe(false);
    });
});

describe('buildHolderLabel', () => {
    it('includes the platform when known, else a generic label; never empty', () => {
        expect(buildHolderLabel('MacIntel')).toBe('this browser on MacIntel');
        expect(buildHolderLabel('')).toBe('this browser');
    });
});
