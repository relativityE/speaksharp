import { describe, it, expect } from 'vitest';
import { githubGet, GithubOpsError, Classification, clampPositiveInt, BOUNDS, RATE_LIMIT_FALLBACK_MS } from '../../scripts/lib/github-ops-fetch.mjs';

// ── Deterministic test harness ────────────────────────────────────────────────
const makeClock = (t0 = 0) => {
  let t = t0;
  return { now: () => t, advance: (ms) => { t += ms; }, value: () => t };
};

const res = (status, { headers = {}, body = {}, text } = {}) => {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() in lower ? lower[name.toLowerCase()] : null) },
    json: async () => body,
    text: async () => (text != null ? text : JSON.stringify(body)),
  };
};

// outcomes: array of (Response | Error | () => Response|Error). A function form can advance the clock.
const scriptedFetch = (outcomes) => {
  const calls = { count: 0 };
  const fn = async () => {
    const outcome = outcomes[Math.min(calls.count, outcomes.length - 1)];
    calls.count += 1;
    const value = typeof outcome === 'function' ? outcome() : outcome;
    if (value instanceof Error) throw value;
    return value;
  };
  fn.calls = calls;
  return fn;
};

const harness = (fetchImpl, { clock = makeClock(), overrides = {} } = {}) => {
  const sleeps = [];
  const timers = []; // per-attempt timeout durations passed to setTimer
  const diagnostics = [];
  return {
    clock,
    sleeps,
    timers,
    diagnostics,
    deps: {
      fetch: fetchImpl,
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); },
      random: () => 0.5, // fixed jitter → deterministic backoff
      now: clock.now,
      setTimer: (_cb, ms) => { timers.push(ms); return 0; },
      clearTimer: () => {},
      onDiagnostic: (d) => diagnostics.push(d),
      ...overrides,
    },
  };
};

const timeoutError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
const opts = (extra = {}) => ({ label: 'repository metadata', token: 'ghp_FAKE_TOKEN_VALUE', baseBackoffMs: 100, maxBackoffMs: 1_000, ...extra });

describe('githubGet — basic resilience', () => {
  it('200 on the first attempt → GREEN, exactly one call, no backoff', async () => {
    const f = scriptedFetch([res(200, { body: { full_name: 'relativityE/speaksharp' } })]);
    const h = harness(f);
    const r = await githubGet('https://api.github.com/repos/x', opts(), h.deps);
    expect(r.ok).toBe(true);
    expect(r.classification).toBe(Classification.OK);
    expect(r.recovered).toBe(false);
    expect(f.calls.count).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  it('503 then 200 → RECOVERED yellow, two calls', async () => {
    const f = scriptedFetch([res(503), res(200, { body: {} })]);
    const h = harness(f);
    const r = await githubGet('https://api.github.com/repos/x', opts(), h.deps);
    expect(r.recovered).toBe(true);
    expect(r.classification).toBe(Classification.RECOVERED);
    expect(r.attempts).toBe(2);
    expect(f.calls.count).toBe(2);
    expect(h.sleeps.length).toBe(1);
  });

  it('503 three times → RED, exactly maxAttempts calls', async () => {
    const f = scriptedFetch([res(503), res(503), res(503)]);
    const h = harness(f);
    await expect(githubGet('https://api.github.com/repos/x', opts({ maxAttempts: 3 }), h.deps)).rejects.toMatchObject({
      classification: Classification.RED,
      attempts: 3,
      status: 503,
    });
    expect(f.calls.count).toBe(3);
  });

  it('timeout then 200 → RECOVERED yellow', async () => {
    const f = scriptedFetch([timeoutError(), res(200, { body: {} })]);
    const h = harness(f);
    const r = await githubGet('https://api.github.com/repos/x', opts(), h.deps);
    expect(r.recovered).toBe(true);
    expect(f.calls.count).toBe(2);
    expect(h.diagnostics[0].error).toContain('timeout');
  });

  it('401 → immediate RED, no retry', async () => {
    const f = scriptedFetch([res(401), res(200)]);
    const h = harness(f);
    await expect(githubGet('https://api.github.com/repos/x', opts(), h.deps)).rejects.toMatchObject({
      classification: Classification.RED,
      status: 401,
    });
    expect(f.calls.count).toBe(1);
    expect(h.sleeps).toEqual([]);
  });
});

describe('githubGet — hard deadline enforcement', () => {
  it('an attempt consuming nearly all budget leaves only the remaining timeout for the next attempt', async () => {
    const clock = makeClock();
    const f = scriptedFetch([() => { clock.advance(29_000); return res(503); }, res(200, { body: {} })]);
    const h = harness(f, { clock });
    const r = await githubGet('https://api.github.com/repos/x', opts({ totalBudgetMs: 30_000, perAttemptTimeoutMs: 15_000 }), h.deps);
    expect(r.recovered).toBe(true);
    expect(h.timers[0]).toBe(15_000); // full budget remained at attempt 1 → capped by perAttemptTimeout
    expect(h.timers[1]).toBe(950); // attempt 2 gets only the remaining budget (30000 - 29000 - 50 backoff)
    expect(h.timers[1]).toBeLessThan(15_000); // strictly less than the nominal per-attempt timeout
  });

  it('budget expiring before another attempt → BUDGET_EXHAUSTED, no extra call', async () => {
    // 403 secondary with Retry-After=1s consumes the whole 1s budget; the next attempt has none left.
    const f = scriptedFetch([res(403, { headers: { 'retry-after': '1', 'x-ratelimit-remaining': '0' } }), res(200)]);
    const h = harness(f);
    await expect(githubGet('https://api.github.com/repos/x', opts({ totalBudgetMs: 1_000 }), h.deps)).rejects.toMatchObject({
      classification: Classification.BUDGET_EXHAUSTED,
    });
    expect(f.calls.count).toBe(1);
    expect(h.sleeps).toEqual([1_000]);
  });

  it('a response that arrives after the deadline cannot become green', async () => {
    const clock = makeClock();
    const f = scriptedFetch([() => { clock.advance(31_000); return res(200, { body: {} }); }]);
    const h = harness(f, { clock });
    const err = await githubGet('https://api.github.com/repos/x', opts({ totalBudgetMs: 30_000 }), h.deps).catch((e) => e);
    expect(err).toBeInstanceOf(GithubOpsError);
    expect(err.classification).toBe(Classification.BUDGET_EXHAUSTED);
    expect(f.calls.count).toBe(1);
  });

  it('a shared deadline caps cumulative time across calls (no per-call budget multiplication)', async () => {
    const clock = makeClock();
    const deadline = clock.now() + 1_000; // shared across both calls, like a whole GitHub row
    // Call 1 succeeds but consumes almost all of the shared budget.
    const f1 = scriptedFetch([() => { clock.advance(900); return res(200, { body: {} }); }]);
    const h1 = harness(f1, { clock });
    const r1 = await githubGet('https://api.github.com/a', opts({ deadline }), h1.deps);
    expect(r1.ok).toBe(true);
    // Call 2 shares the SAME deadline; only ~100ms remains, so it cannot complete → BUDGET_EXHAUSTED,
    // rather than getting a fresh full budget (which would multiply the row's wall-clock).
    const f2 = scriptedFetch([() => { clock.advance(200); return res(200, { body: {} }); }]);
    const h2 = harness(f2, { clock });
    const err = await githubGet('https://api.github.com/b', opts({ deadline }), h2.deps).catch((e) => e);
    expect(err.classification).toBe(Classification.BUDGET_EXHAUSTED);
  });
});

describe('githubGet — rate-limit behavior', () => {
  it('403 with no rate-limit evidence → permission RED, no retry', async () => {
    const f = scriptedFetch([res(403, { body: { message: 'Resource not accessible by integration' } }), res(200)]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', opts(), h.deps).catch((e) => e);
    expect(err.classification).toBe(Classification.RED);
    expect(err.message).toContain('permission failure');
    expect(f.calls.count).toBe(1);
  });

  it('403 with Retry-After within budget → waits exactly as directed, then recovers', async () => {
    const f = scriptedFetch([res(403, { headers: { 'retry-after': '2', 'x-ratelimit-remaining': '0' } }), res(200, { body: {} })]);
    const h = harness(f);
    const r = await githubGet('https://api.github.com/repos/x', opts({ totalBudgetMs: 30_000 }), h.deps);
    expect(r.recovered).toBe(true);
    expect(h.sleeps).toEqual([2_000]); // exactly Retry-After, not a jittered backoff
  });

  it('secondary-rate-limit body language is detected (routed to rate limiting, not permission RED)', async () => {
    const f = scriptedFetch([res(403, { text: 'You have exceeded a secondary rate limit. Please wait a few minutes.' })]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', opts({ totalBudgetMs: 30_000 }), h.deps).catch((e) => e);
    // No usable headers → GitHub fallback (>=60s) exceeds the 30s budget → RATE_LIMITED (not permission RED).
    expect(err.classification).toBe(Classification.RATE_LIMITED);
    expect(f.calls.count).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  it('429 with no usable headers → RATE_LIMITED immediately (never a 0–500ms backoff)', async () => {
    const f = scriptedFetch([res(429, { body: {} })]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', opts({ totalBudgetMs: 30_000 }), h.deps).catch((e) => e);
    expect(err.classification).toBe(Classification.RATE_LIMITED);
    expect(err.message).toContain(String(RATE_LIMIT_FALLBACK_MS));
    expect(f.calls.count).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  it('429 with reset beyond budget → RATE_LIMITED, no busy retry', async () => {
    const f = scriptedFetch([res(429, { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '999999999' } })]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', opts({ totalBudgetMs: 5_000 }), h.deps).catch((e) => e);
    expect(err.classification).toBe(Classification.RATE_LIMITED);
    expect(f.calls.count).toBe(1);
    expect(h.sleeps).toEqual([]);
  });
});

describe('githubGet — diagnostics and secret sanitization', () => {
  it('captures request-id and rate-limit headers in diagnostics; RED names the sub-check + request-id', async () => {
    const f = scriptedFetch([
      res(503, { headers: { 'x-github-request-id': 'ABCD:1234', 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '742', 'x-ratelimit-reset': '111' } }),
      res(503),
      res(503),
    ]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', opts({ maxAttempts: 3 }), h.deps).catch((e) => e);
    expect(h.diagnostics[0]).toMatchObject({ label: 'repository metadata', attempt: 1, requestId: 'ABCD:1234', rateLimitRemaining: '742' });
    expect(err.message).toContain('repository metadata');
    expect(err.message).toContain('request-id=ABCD:1234');
    expect(err.diagnostics.length).toBe(3);
  });

  it('a thrown network Error containing a token is sanitized in diagnostics and the terminal error', async () => {
    const secret = 'ghp_NETWORKERRORTOKEN0987654321';
    const f = scriptedFetch([new Error(`connect ECONNREFUSED using ${secret}`)]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', opts({ token: secret, maxAttempts: 1 }), h.deps).catch((e) => e);
    const serialized = JSON.stringify(h.diagnostics) + err.message;
    expect(serialized).not.toContain(secret);
    expect(h.diagnostics[0].error).toContain('[redacted]');
  });

  it('a failure response body containing a token is sanitized in diagnostics and the terminal error', async () => {
    const secret = 'ghp_BODYLEAKTOKEN1122334455';
    const f = scriptedFetch([res(403, { text: `secondary rate limit hit; debug token=${secret}` })]);
    const h = harness(f);
    const err = await githubGet('https://api.github.com/repos/x', opts({ token: secret, totalBudgetMs: 30_000 }), h.deps).catch((e) => e);
    const serialized = JSON.stringify(h.diagnostics) + err.message;
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('Authorization');
    expect(h.diagnostics[0].body).toContain('[redacted]');
  });
});

describe('clampPositiveInt — tunable validation', () => {
  it('non-finite → fallback', () => {
    expect(clampPositiveInt('nope', BOUNDS.maxAttempts)).toBe(3);
    expect(clampPositiveInt(undefined, BOUNDS.totalBudgetMs)).toBe(30_000);
    expect(clampPositiveInt(NaN, BOUNDS.perAttemptTimeoutMs)).toBe(15_000);
  });
  it('below min → min; above max → max; floats floored', () => {
    expect(clampPositiveInt(0, BOUNDS.maxAttempts)).toBe(1);
    expect(clampPositiveInt(-5, BOUNDS.maxAttempts)).toBe(1);
    expect(clampPositiveInt(999, BOUNDS.maxAttempts)).toBe(10);
    expect(clampPositiveInt(3.9, BOUNDS.maxAttempts)).toBe(3);
    expect(clampPositiveInt(500_000, BOUNDS.totalBudgetMs)).toBe(300_000);
  });
  it('githubGet clamps an out-of-range maxAttempts (0 → 1 → single attempt)', async () => {
    const f = scriptedFetch([res(503), res(503)]);
    const h = harness(f);
    await expect(githubGet('https://api.github.com/repos/x', opts({ maxAttempts: 0 }), h.deps)).rejects.toBeInstanceOf(GithubOpsError);
    expect(f.calls.count).toBe(1);
  });
});
