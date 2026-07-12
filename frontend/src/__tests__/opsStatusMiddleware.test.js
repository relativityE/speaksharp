// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import middleware from '../../../middleware.js';

// Unit test for the Vercel Edge middleware that gates /admin/ops-status with HTTP
// Basic auth. This is the SOLE production gate for the ops page (the in-app route is
// intentionally not behind InternalRoute — see App.tsx / config/internalRoutes.ts).

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

  it('challenges with 401 + WWW-Authenticate when no credentials are supplied', () => {
    process.env.OPS_STATUS_PASSWORD = 'new-secret';
    const res = middleware(requestFor());
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
  });

  it('passes through (undefined) with the correct admin credentials', () => {
    process.env.OPS_STATUS_PASSWORD = 'new-secret';
    expect(middleware(requestFor(basicHeader('admin', 'new-secret')))).toBeUndefined();
  });

  it('rejects the OLD password after rotation and accepts the NEW one', () => {
    process.env.OPS_STATUS_PASSWORD = 'new-secret'; // rotated in Vercel + redeployed
    expect(middleware(requestFor(basicHeader('admin', 'old-secret'))).status).toBe(401);
    expect(middleware(requestFor(basicHeader('admin', 'new-secret')))).toBeUndefined();
  });

  it('fails closed (401) when OPS_STATUS_PASSWORD is not configured', () => {
    delete process.env.OPS_STATUS_PASSWORD;
    const res = middleware(requestFor(basicHeader('admin', 'anything')));
    expect(res.status).toBe(401);
  });

  it('honors a custom OPS_STATUS_USERNAME', () => {
    process.env.OPS_STATUS_PASSWORD = 'pw';
    process.env.OPS_STATUS_USERNAME = 'ops';
    expect(middleware(requestFor(basicHeader('admin', 'pw'))).status).toBe(401); // wrong user
    expect(middleware(requestFor(basicHeader('ops', 'pw')))).toBeUndefined();
  });

  it('ignores paths outside /admin/ops-status (no auth imposed elsewhere)', () => {
    process.env.OPS_STATUS_PASSWORD = 'pw';
    const res = middleware({
      url: 'https://speaksharp-public.vercel.app/session',
      headers: { get: () => null },
    });
    expect(res).toBeUndefined();
  });
});
