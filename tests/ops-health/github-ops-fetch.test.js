import { describe, it, expect } from 'vitest';
import { githubGet, GithubOpsError, Classification } from '../../scripts/lib/github-ops-fetch.mjs';

// ── Deterministic test harness ────────────────────────────────────────────────
// A fake Response with a case-insensitive header bag.
const res = (status, { headers = {}, body = {} } = {}) => {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() in lower ? lower[name.toLowerCase()] : null) },
    json: async () => body,
  };
};

// A fetch stub that returns/throws the queued outcomes in order and counts calls.
const scriptedFetch = (outcomes) => {
  const calls = { count: 0 };
  const fn = async () => {
    const outcome = outcomes[Math.min(calls.count, outcomes.length - 1)];
    calls.count += 1;
    if (outcome instanceof Error) throw outcome;
    if (typeof outcome === 'function') return outcome();
    return outcome;
  };
  fn.calls = calls;
  return fn;
};

// A deterministic clock advanced only by sleep(); no real timers, no real waiting.
const harness = (fetchImpl, overrides = {}) => {
  let clock = 0;
  const sleeps = [];
  const diagnostics = [];
  return {
    fetchImpl,
    sleeps,
    diagnostics,
    deps: {
      fetch: fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      random: () => 0.5, // fixed jitter → deterministic backoff
      now: () => clock,
      setTimer: () => 0, // no real per-attempt timer in tests
      clearTimer: () => {},
      onDiagnostic: (d) => diagnostics.push(d),
      ...overrides,
    },
  };
};

const timeoutError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

const baseOpts = { label: 'repository metadata', token: 'ghp_FAKE_TOKEN_VALUE', baseBackoffMs: 100, maxBackoffMs: 1_000 };

describe('githubGet resilience', () => {
  it('200 on the first attempt → GREEN, exactly one call', async () => {
    const f = scriptedFetch([res(200, { body: { full_name: 'relativityE/speaksharp' } })]);
    const h = harness(f);
    const r = await githubGet('https://api.github.com/repos/x', baseOpts, h.deps);
    expect(r.ok).toBe(true);
    expect(r.classification).toBe(Classification.OK);
    expect(r.recovered).toBe(false);
    expect(r.attempts).toBe(1);
    expect(f.calls.count).toBe(1);
    expect(h.sleeps).toEqual([]); // no backoff on first-try success
    expect(r.body.full_name).toBe('relativityE/speaksharp');
  });

  it('503 then 200 → RECOVERED yellow, two calls', async () => {
    const f = scriptedFetch([res(503), res(200, { body: { ok: true } })]);
    const h = harness(f);
    const r = await githubGet('https://api.github.com/repos/x', baseOpts, h.deps);
    expect(r.ok).toBe(true);
    expect(r.recovered).toBe(true);
    expect(r.classification).toBe(Classification.RECOVERED);
    expect(r.attempts).toBe(2);
    expect(f.calls.count).toBe(2);
    expect(h.sleeps.length).toBe(1); // one bounded backoff between the two attempts
  });

  it('503 three times → RED, exactly maxAttempts calls, labeled error', async () => {
    const f = scriptedFetch([res(503), res(503), res(503)]);
    const h = harness(f);
    await expect(githubGet('https://api.github.com/repos/x', { ...baseOpts, maxAttempts: 3 }, h.deps)).rejects.toMatchObject({
      name: 'GithubOpsError',
      classification: Classification.RED,
      attempts: 3,
      status: 503,
    });
    expect(f.calls.count).toBe(3);
  });

  it('timeout then 200 → RECOVERED yellow', async () => {
    const f = scriptedFetch([timeoutError(), res(200, { body: {} })]);
    const h = harness(f);
    const r = await githubGet('https://api.github.com/repos/x', baseOpts, h.deps);
    expect(r.recovered).toBe(true);
    expect(r.attempts).toBe(2);
    expect(f.calls.count).toBe(2);
    expect(h.diagnostics[0].error).toContain('timeout');
  });

  it('401 → immediate RED, no retry', async () => {
    const f = scriptedFetch([res(401), res(200)]);
    const h = harness(f);
    await expect(githubGet('https://api.github.com/repos/x', baseOpts, h.deps)).rejects.toMatchObject({
      classification: Classification.RED,
      status: 401,
      attempts: 1,
    });
    expect(f.calls.count).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  it('non-rate-limit 403 → immediate RED (not treated as rate limiting)', async () => {
    const f = scriptedFetch([res(403), res(200)]); // no retry-after / ratelimit headers
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', baseOpts, h.deps).catch((e) => e);
    expect(err).toBeInstanceOf(GithubOpsError);
    expect(err.classification).toBe(Classification.RED);
    expect(err.message).toContain('permission failure');
    expect(f.calls.count).toBe(1);
  });

  it('403 with Retry-After → honors the header within budget, then recovers', async () => {
    const f = scriptedFetch([
      res(403, { headers: { 'retry-after': '2', 'x-ratelimit-remaining': '0' } }),
      res(200, { body: {} }),
    ]);
    const h = harness(f, {});
    const r = await githubGet('https://api.github.com/repos/x', { ...baseOpts, totalBudgetMs: 30_000 }, h.deps);
    expect(r.recovered).toBe(true);
    expect(f.calls.count).toBe(2);
    expect(h.sleeps).toEqual([2000]); // waited exactly Retry-After (2s), not a jittered backoff
  });

  it('429 with reset beyond budget → RED/RATE_LIMITED, no busy retry', async () => {
    // remaining=0 and reset far in the future → required wait dwarfs the budget.
    const f = scriptedFetch([res(429, { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '999999999' } })]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', { ...baseOpts, totalBudgetMs: 5_000 }, h.deps).catch((e) => e);
    expect(err).toBeInstanceOf(GithubOpsError);
    expect(err.classification).toBe(Classification.RATE_LIMITED);
    expect(f.calls.count).toBe(1); // did not hammer
    expect(h.sleeps).toEqual([]); // did not busy-wait
  });

  it('captures request-id and rate-limit headers in sanitized diagnostics', async () => {
    const f = scriptedFetch([
      res(503, { headers: { 'x-github-request-id': 'ABCD:1234', 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '742', 'x-ratelimit-reset': '111' } }),
      res(503),
      res(503),
    ]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', { ...baseOpts, maxAttempts: 3 }, h.deps).catch((e) => e);
    const first = h.diagnostics[0];
    expect(first.requestId).toBe('ABCD:1234');
    expect(first.rateLimitLimit).toBe('1000');
    expect(first.rateLimitRemaining).toBe('742');
    expect(first.label).toBe('repository metadata');
    expect(first.attempt).toBe(1);
    // The thrown error also surfaces the diagnostics + the endpoint label (not "github=503").
    expect(err.message).toContain('repository metadata');
    expect(err.message).toContain('request-id=ABCD:1234');
    expect(err.diagnostics.length).toBe(3);
  });

  it('never leaks the token in diagnostics or the error message', async () => {
    const secret = 'ghp_SUPERSECRETTOKEN1234567890';
    const f = scriptedFetch([res(500, { body: { message: `bad creds ${secret}` } }), res(500), res(500)]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', { ...baseOpts, token: secret, maxAttempts: 3 }, h.deps).catch((e) => e);
    const serialized = JSON.stringify(h.diagnostics) + err.message;
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('Authorization');
  });
});
