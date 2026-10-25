/**
 * #1643 — each closed completion state renders one truthful status sentence: no retry or repeat-request affordance in
 * any state, and "deleted" only for the server's verified `completed`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountCompletionStatusNotice } from '@/components/account/AccountCompletionStatusNotice';
import type { AccountCompletionStatus } from '@/services/accountCompletionStatus';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const states: [string, AccountCompletionStatus, RegExp][] = [
  ['pending/checkout', { outcome: 'pending', requestId, reason: 'checkout_unsettled', canRetry: false }, /pending\. Your account has not been deleted\. A checkout is still being settled\./],
  ['pending/save', { outcome: 'pending', requestId, reason: 'save_unsettled', canRetry: false }, /A practice session is still being saved\./],
  ['pending/coaching', { outcome: 'pending', requestId, reason: 'coaching_unsettled', canRetry: false }, /A coaching request is still finishing\./],
  ['pending/coverage', { outcome: 'pending', requestId, reason: 'coverage_unverified', canRetry: false }, /still confirming everything linked/],
  ['pending/ready', { outcome: 'pending', requestId, reason: 'ready', canRetry: false }, /Deletion has not started\./],
  ['processing', { outcome: 'processing', requestId, canRetry: false }, /Your account is being deleted\./],
  ['verification_pending', { outcome: 'verification_pending', requestId, reason: 'auth_unknown', canRetry: false }, /cannot confirm the result of your deletion yet/],
  ['completed', { outcome: 'completed', requestId, accountDeleted: true, canRetry: false }, /^Your account has been deleted\.$/],
  ['unavailable', { outcome: 'unavailable', canRetry: false }, /could not verify your account deletion status/],
];

describe('#1643 AccountCompletionStatusNotice', () => {
  it.each(states)('%s renders its status sentence with no action', (_label, status, copy) => {
    render(<AccountCompletionStatusNotice status={status} />);
    expect(screen.getByRole('status').textContent).toMatch(copy);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it.each(states.filter(([, status]) => status.outcome !== 'completed'))(
    'CASUALTY: %s never claims the account was deleted',
    (_label, status) => {
      render(<AccountCompletionStatusNotice status={status} />);
      expect(screen.getByRole('status').textContent).not.toMatch(/has been deleted/);
    },
  );

  it('internal verification reasons are not shown to the user', () => {
    render(<AccountCompletionStatusNotice status={{ outcome: 'verification_pending', requestId, reason: 'operation_unknown', canRetry: false }} />);
    expect(screen.getByRole('status').textContent).not.toMatch(/operation_unknown|unknown operation/i);
  });
});
