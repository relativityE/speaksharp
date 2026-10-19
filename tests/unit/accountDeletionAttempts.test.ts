import { describe, expect, it } from 'vitest';
import { accountDeletionAttempts } from '../../frontend/src/services/accountDeletionAttempts';

describe('#1643 observed pending dominates delayed confirmation replies', () => {
  it.each(['ready', 'reconciliation'] as const)('preserves durable request identity through late %s', (phase) => {
    const owner = `observed-pending-${phase}`;
    const attempt = accountDeletionAttempts.begin(owner)!;
    expect(accountDeletionAttempts.observePending(owner, 'request-1')).toBe(true);
    accountDeletionAttempts.finish(owner, attempt, { phase, message: 'delayed reply' });
    expect(accountDeletionAttempts.snapshot(owner).phase).toBe('reconciliation');
    expect(accountDeletionAttempts.begin(owner)).toBeNull();
    expect(accountDeletionAttempts.observePending(owner, 'request-2')).toBe(false);
  });

  it('keeps a genuinely refused confirmation ready when no durable pending was observed', () => {
    const owner = 'genuine-refusal-without-observed-pending';
    const attempt = accountDeletionAttempts.begin(owner)!;
    accountDeletionAttempts.finish(owner, attempt, { phase: 'ready', message: 'verified refusal' });
    expect(accountDeletionAttempts.snapshot(owner).phase).toBe('ready');
    expect(accountDeletionAttempts.begin(owner)).not.toBeNull();
  });
});
