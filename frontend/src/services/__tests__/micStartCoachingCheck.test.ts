import { describe, expect, it, vi } from 'vitest';
import { startMicCoachingCheck } from '../micStartCoachingCheck';

describe('mic-start coaching readiness', () => {
    it('does not send if coaching is unchecked, unknown, or recording was not confirmed', async () => {
        const probe = vi.fn().mockResolvedValue(undefined);
        startMicCoachingCheck({ recordingConfirmed: true, consentStillHolds: () => false }, probe);
        startMicCoachingCheck({ recordingConfirmed: false, consentStillHolds: () => true }, probe);
        await Promise.resolve();
        expect(probe).not.toHaveBeenCalled();
    });
    it('suppresses a queued probe when the checkbox or account changes before send', async () => {
        const probe = vi.fn().mockResolvedValue(undefined);
        let allowed = true;
        startMicCoachingCheck({ recordingConfirmed: true, consentStillHolds: () => allowed }, probe);
        allowed = false;
        await Promise.resolve();
        expect(probe).not.toHaveBeenCalled();
    });
    it('confirmed opt-in queues one request without awaiting it or throwing its failure', async () => {
        const probe = vi.fn().mockRejectedValue(new Error('503'));
        expect(startMicCoachingCheck({ recordingConfirmed: true, consentStillHolds: () => true }, probe)).toBeUndefined();
        expect(probe).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(probe).toHaveBeenCalledTimes(1);
    });
});
