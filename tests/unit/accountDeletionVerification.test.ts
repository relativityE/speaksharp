import { describe, expect, it, vi } from 'vitest';
import { captureDeletionToken } from '../../frontend/src/services/accountDeletionVerification';

describe('emailed deletion secret at the application startup boundary', () => {
  const token = 'a'.repeat(64);
  it('claims the startup token once before asynchronous work and rejects stale or mismatched claims', async () => {
    const previous = window.location.href;
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    try {
      window.location.href = `http://localhost:5173/account/delete?account_deletion_token=${token}`;
      vi.resetModules();
      const service = await import('../../frontend/src/services/accountDeletionVerification');
      expect(replaceState).toHaveBeenCalledWith(window.history.state, '', 'http://localhost:5173/account/delete');
      expect(service.consumeAccountDeletionToken('b'.repeat(64))).toBe(false);
      expect(service.accountDeletionToken()).toBe(token);
      expect(service.consumeAccountDeletionToken(token)).toBe(true);
      expect(service.accountDeletionToken()).toBeNull();
      expect(service.consumeAccountDeletionToken(token)).toBe(false);
    } finally {
      window.location.href = previous;
      replaceState.mockRestore();
    }
  });
  it('removes the secret before telemetry while retaining Supabase authentication and unrelated parameters', () => {
    const result = captureDeletionToken(new URL(`https://example.test/account/delete?account_deletion_token=${token}&other=keep#access_token=auth`));
    expect(result.token).toBe(token);
    expect(result.sanitized.search).toBe('?other=keep');
    expect(result.sanitized.hash).toBe('#access_token=auth');
    expect(result.sanitized.href).not.toContain(token);
  });
  it('never accepts a token on another page, but still scrubs it', () => {
    const result = captureDeletionToken(new URL(`https://example.test/?account_deletion_token=${token}`));
    expect(result.token).toBeNull();
    expect(result.sanitized.search).toBe('');
  });
  it.each(['short', 'G'.repeat(64), 'a'.repeat(65)])('scrubs and rejects malformed tokens', (value) => {
    const result = captureDeletionToken(new URL(`https://example.test/account/delete?account_deletion_token=${value}`));
    expect(result.token).toBeNull();
    expect(result.sanitized.search).toBe('');
  });
});
