import { describe, expect, it } from 'vitest';
import { captureDeletionToken } from '../../frontend/src/services/accountDeletionVerification';

describe('emailed deletion secret at the application startup boundary', () => {
  const token = 'a'.repeat(64);
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
