// @vitest-environment jsdom
/**
 * #1643 — App client for the accepted inactive completion HTTP contract (192c489c). Issue/ack carry the live owner's
 * Bearer; read carries only the capability. Bodies are exactly the handler's closed shapes. Every failure is
 * `unavailable`/false — never completion — and the raw key never leaves memory.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCompletionStatus, secureStatusCapability, type CompletionTransport } from '@/services/accountCompletionClient';
import { completionCapabilities } from '@/services/accountCompletionStatus';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = 'c'.repeat(64);
const NOW = 1_792_545_000_000;
const now = () => NOW;
const capabilityReply = { outcome: 'status_capability', requestId, token, expiresAt: NOW + 900_000 };
const ackReply = { outcome: 'status_acknowledged', requestId };

afterEach(() => completionCapabilities.clear());

describe('#1643 secureStatusCapability', () => {
  it('issues then acknowledges with the owner Bearer, using the handler\'s exact body shapes', async () => {
    const transport = vi.fn<CompletionTransport>().mockResolvedValueOnce(capabilityReply).mockResolvedValueOnce(ackReply);
    expect(await secureStatusCapability(transport, 'owner-a', requestId, 'jwt-a', now)).toBe(true);
    expect(transport.mock.calls).toEqual([
      [{ action: 'completion_status_issue', requestId }, 'jwt-a'],
      [{ action: 'completion_status_ack', requestId, token }, 'jwt-a'],
    ]);
    expect(completionCapabilities.get('owner-a', requestId, NOW)?.acknowledged).toBe(true);
  });

  it('an already acknowledged capability is not re-issued (no replacement churn)', async () => {
    completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
    completionCapabilities.acknowledge('owner-a', requestId, token, NOW);
    const transport = vi.fn<CompletionTransport>();
    expect(await secureStatusCapability(transport, 'owner-a', requestId, 'jwt-a', now)).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });

  it('CASUALTY: a lost ACK reply re-acknowledges the SAME held key; it does not request a new one', async () => {
    const transport = vi.fn<CompletionTransport>()
      .mockResolvedValueOnce(capabilityReply).mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce(ackReply);
    expect(await secureStatusCapability(transport, 'owner-a', requestId, 'jwt-a', now)).toBe(false);
    expect(await secureStatusCapability(transport, 'owner-a', requestId, 'jwt-a', now)).toBe(true);
    expect(transport.mock.calls.map(([body]) => body.action)).toEqual(['completion_status_issue', 'completion_status_ack', 'completion_status_ack']);
  });

  it('CASUALTY: an ACK reply that arrives after the deadline does not acknowledge the expired key', async () => {
    let clock = NOW;
    const transport = vi.fn<CompletionTransport>().mockResolvedValueOnce({ ...capabilityReply, expiresAt: NOW + 10 })
      .mockImplementationOnce(async () => { clock = NOW + 10; return ackReply; });
    expect(await secureStatusCapability(transport, 'owner-a', requestId, 'jwt-a', () => clock)).toBe(false);
    expect(completionCapabilities.get('owner-a', requestId, NOW)).toBeNull();
  });

  it.each([
    ['an unavailable issue reply', { outcome: 'unavailable', canRetry: false }, ackReply],
    ['a capability for another request', { ...capabilityReply, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, ackReply],
    ['an unavailable ack', capabilityReply, { outcome: 'unavailable', canRetry: false }],
  ])('FENCE: %s secures nothing', async (_label, issued, acked) => {
    const transport = vi.fn<CompletionTransport>().mockResolvedValueOnce(issued).mockResolvedValueOnce(acked);
    expect(await secureStatusCapability(transport, 'owner-a', requestId, 'jwt-a', now)).toBe(false);
    expect(completionCapabilities.get('owner-a', requestId, NOW)?.acknowledged ?? false).toBe(false);
  });
});

describe('#1643 readCompletionStatus', () => {
  const secured = () => {
    completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
    completionCapabilities.acknowledge('owner-a', requestId, token, NOW);
  };

  it('reads with the capability only (no Bearer) and returns the closed state', async () => {
    secured();
    const transport = vi.fn<CompletionTransport>().mockResolvedValue({ outcome: 'completed', requestId, accountDeleted: true, canRetry: false });
    expect(await readCompletionStatus(transport, 'owner-a', requestId, now)).toEqual({ outcome: 'completed', requestId, accountDeleted: true, canRetry: false });
    expect(transport).toHaveBeenCalledWith({ action: 'completion_status_read', requestId, token }, null);
  });

  it.each([
    ['no held capability', false, { outcome: 'completed', requestId, accountDeleted: true, canRetry: false }],
    ['a transport failure', true, new Error('network')],
    ['a malformed reply', true, { outcome: 'deleted', accountDeleted: true }],
    ['the handler 400 shape', true, { error: 'invalid_request' }],
  ])('FENCE: %s reads as unavailable, never completion', async (_label, hold, reply) => {
    if (hold) secured();
    const transport = vi.fn<CompletionTransport>();
    if (reply instanceof Error) transport.mockRejectedValue(reply); else transport.mockResolvedValue(reply);
    expect(await readCompletionStatus(transport, 'owner-a', requestId, now)).toEqual({ outcome: 'unavailable', canRetry: false });
  });

  it('FENCE: an unacknowledged capability is not used to read', async () => {
    completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
    const transport = vi.fn<CompletionTransport>();
    expect((await readCompletionStatus(transport, 'owner-a', requestId, now)).outcome).toBe('unavailable');
    expect(transport).not.toHaveBeenCalled();
  });
});
