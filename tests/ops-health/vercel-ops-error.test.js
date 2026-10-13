import assert from 'node:assert/strict';
import { it as test } from 'vitest';
import { vercelErrorEvidence } from '../../scripts/lib/vercel-ops-error.mjs';

test('captures Vercel forbidden code and documented message', () => {
  assert.equal(vercelErrorEvidence(JSON.stringify({ error: { code: 'forbidden', message: 'Not authorized' } })),
    'apiCode=forbidden; apiMessage=not_authorized');
});

test('does not publish arbitrary error text or tokens', () => {
  const secret = 'secret_123456789';
  const detail = vercelErrorEvidence(JSON.stringify({ error: { code: secret, message: `Token ${secret} lacks team access` } }));
  assert.equal(detail, 'apiCode=other; apiMessage=withheld');
  assert.ok(!detail.includes(secret));
});

test('discloses body shape without copying malformed or unexpected bodies', () => {
  assert.equal(vercelErrorEvidence('<html>secret</html>'), 'apiError=non-json');
  assert.equal(vercelErrorEvidence(JSON.stringify({ error: 'secret' })), 'apiError=unexpected-schema');
});
