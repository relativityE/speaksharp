// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import middleware, { constantTimeEqual } from '../../../middleware.js';

// Unit test for the Vercel Edge middleware that gates /admin/ops-status with HTTP
// Basic auth. This is the SOLE production gate for the ops page (the in-app route is
// intentionally not behind InternalRoute — see App.tsx / config/internalRoutes.ts).

const HERE = dirname(fileURLToPath(import.meta.url));

const OPS_PATH = 'https://speaksharp-public.vercel.app/admin/ops-status';

const basicHeader = (user, pass) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

const requestFor = (authorization) => ({
  url: OPS_PATH,
  headers: {
    get: (name) => (name.toLowerCase() === 'authorization' ? authorization ?? null : null),
  },
});

describe('ops-status edge middleware — Basic auth (sole production gate)', () => {
  const originalPassword = process.env.OPS_STATUS_PASSWORD;
  const originalUsername = process.env.OPS_STATUS_USERNAME;

  beforeEach(() => {
    delete process.env.OPS_STATUS_USERNAME; // default user = 'admin'
  });

  afterEach(() => {
    if (originalPassword === undefined) delete process.env.OPS_STATUS_PASSWORD;
    else process.env.OPS_STATUS_PASSWORD = originalPassword;
    if (originalUsername === undefined) delete process.env.OPS_STATUS_USERNAME;
    else process.env.OPS_STATUS_USERNAME = originalUsername;
  });

  it('challenges with 401 + WWW-Authenticate when no credentials are supplied', async () => {
    process.env.OPS_STATUS_PASSWORD = 'new-secret';
    const res = await middleware(requestFor());
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
  });

  it('passes through (undefined) with the correct admin credentials', async () => {
    process.env.OPS_STATUS_PASSWORD = 'new-secret';
    expect(await middleware(requestFor(basicHeader('admin', 'new-secret')))).toBeUndefined();
  });

  it('rejects the OLD password after rotation and accepts the NEW one', async () => {
    process.env.OPS_STATUS_PASSWORD = 'new-secret'; // rotated in Vercel + redeployed
    expect((await middleware(requestFor(basicHeader('admin', 'old-secret')))).status).toBe(401);
    expect(await middleware(requestFor(basicHeader('admin', 'new-secret')))).toBeUndefined();
  });

  it('fails closed (401) when OPS_STATUS_PASSWORD is not configured', async () => {
    delete process.env.OPS_STATUS_PASSWORD;
    const res = await middleware(requestFor(basicHeader('admin', 'anything')));
    expect(res.status).toBe(401);
  });

  it('honors a custom OPS_STATUS_USERNAME', async () => {
    process.env.OPS_STATUS_PASSWORD = 'pw';
    process.env.OPS_STATUS_USERNAME = 'ops';
    expect((await middleware(requestFor(basicHeader('admin', 'pw')))).status).toBe(401); // wrong user
    expect(await middleware(requestFor(basicHeader('ops', 'pw')))).toBeUndefined();
  });

  it('ignores paths outside /admin/ops-status (no auth imposed elsewhere)', async () => {
    process.env.OPS_STATUS_PASSWORD = 'pw';
    const res = await middleware({
      url: 'https://speaksharp-public.vercel.app/session',
      headers: { get: () => null },
    });
    expect(res).toBeUndefined();
  });

  it('rejects a password that differs only after a shared prefix, or by length', async () => {
    process.env.OPS_STATUS_PASSWORD = 'correct-horse';
    for (const guess of ['correct-hors', 'correct-horsE', 'correct-horse ', '', 'c']) {
      expect((await middleware(requestFor(basicHeader('admin', guess)))).status).toBe(401);
    }
  });

  it('rejects a Basic header with no colon separator', async () => {
    process.env.OPS_STATUS_PASSWORD = 'pw';
    const res = await middleware(requestFor(`Basic ${Buffer.from('adminpw').toString('base64')}`));
    expect(res.status).toBe(401);
  });
});

describe('constantTimeEqual', () => {
  it('matches equal strings and rejects every other pair', async () => {
    expect(await constantTimeEqual('s3cret', 's3cret')).toBe(true);
    expect(await constantTimeEqual('', '')).toBe(true);
    expect(await constantTimeEqual('s3cret', 's3creT')).toBe(false);
    expect(await constantTimeEqual('s3cret', 's3cret!')).toBe(false);
    expect(await constantTimeEqual('', 's3cret')).toBe(false);
    expect(await constantTimeEqual('pässwörd', 'passwort')).toBe(false);
  });

  it('never uses a short-circuiting string comparison on the secret', () => {
    const source = readFileSync(resolve(HERE, '../../../middleware.js'), 'utf8');
    expect(source).not.toMatch(/password\s*===/);
    expect(source).not.toMatch(/===\s*expectedPassword/);
  });
});
