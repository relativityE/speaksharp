import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyFreshness,
  isRealReleaseId,
  parseReleaseFromHtml,
  fetchDeployedRelease,
  checkClientFreshness,
  canRecord,
  blockedMessage,
  STALE_CLIENT_MESSAGE,
  UNVERIFIED_CLIENT_MESSAGE,
  FRESHNESS_BUDGET_MS,
  freshnessSchedule,
} from '@/services/staleClientGuard';

const SHA_A = '307462931905ddcaac1eac303821c4291b7e0257';
const SHA_B = 'db6d9ccef8a14bc0d1e2f3a4b5c6d7e8f9012345';
const html = (id: string) => `<head><script>window.__APP_RELEASE__="${id}";</script></head>`;

describe('#1314 stale-client guard — release parsing', () => {
  it('extracts the id the release-inject plugin actually writes', () => {
    expect(parseReleaseFromHtml(html(SHA_A))).toBe(SHA_A);
  });

  it('tolerates single quotes and whitespace', () => {
    expect(parseReleaseFromHtml(`<script>window.__APP_RELEASE__ = '${SHA_A}' ;</script>`)).toBe(SHA_A);
  });

  it('returns null when the marker is absent or empty rather than guessing', () => {
    expect(parseReleaseFromHtml('<html><body>no marker</body></html>')).toBeNull();
    expect(parseReleaseFromHtml('<script>window.__APP_RELEASE__="";</script>')).toBeNull();
  });
});

describe('#1314 stale-client guard — what counts as a real release id', () => {
  it('accepts a deployed SHA', () => {
    expect(isRealReleaseId(SHA_A)).toBe(true);
  });

  it('rejects local/dev placeholders so local development is never blocked', () => {
    for (const id of ['dev', 'DEV', 'development', 'local', '', '  ', null, undefined]) {
      expect(isRealReleaseId(id as string | null)).toBe(false);
    }
  });
});

describe('#1314 stale-client guard — FAIL-CLOSED classification (PO ruling)', () => {
  it('matching real ids are fresh', () => {
    expect(classifyFreshness(SHA_A, SHA_A)).toBe('fresh');
  });

  it('DIFFERING real ids are stale — the case that corrupts a session', () => {
    expect(classifyFreshness(SHA_A, SHA_B)).toBe('stale');
  });

  it('a PRODUCTION build we could not verify is `unverified`, and unverified must NOT record', () => {
    // The ruling: "we could not check" is not permission. While the legacy transcript-writing overload is
    // callable, an unverifiable production client recreates the exact hazard the guard exists to prevent.
    expect(classifyFreshness(SHA_A, null)).toBe('unverified');
    expect(canRecord('unverified')).toBe(false);
  });

  it('a local/dev build is `local` and MAY record — there is nothing to compare against', () => {
    expect(classifyFreshness('dev', SHA_A)).toBe('local');
    expect(classifyFreshness(null, null)).toBe('local');
    expect(canRecord('local')).toBe(true);
  });

  it('only fresh and local may record', () => {
    expect(canRecord('fresh')).toBe(true);
    expect(canRecord('stale')).toBe(false);
  });

  it('an unresolvable deployed release is never silently treated as a match', () => {
    // The critical asymmetry: a failed lookup must never be optimistically read as "up to date".
    expect(classifyFreshness(SHA_A, null)).not.toBe('fresh');
    expect(classifyFreshness(SHA_A, 'dev')).not.toBe('fresh');
  });
});

describe('#1314 stale-client guard — network posture', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; vi.unstubAllGlobals(); });

  it('bypasses the HTTP cache, or it would re-read the very stale copy it is detecting', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => html(SHA_A) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(fetchDeployedRelease()).resolves.toBe(SHA_A);
    expect(fetchMock).toHaveBeenCalledWith('/index.html', expect.objectContaining({ cache: 'reload' }));
  });

  it('a network failure yields null (-> unverified), not a false "fresh"', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(fetchDeployedRelease()).resolves.toBeNull();
  });

  it('a non-2xx response yields null rather than parsing an error page', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, text: async () => '<h1>502</h1>' }) as unknown as typeof fetch;
    await expect(fetchDeployedRelease()).resolves.toBeNull();
  });
});

describe('#1314 stale-client guard — the freshness check must fit its wall-clock budget', () => {
  // The first revision used a 4s PER-ATTEMPT timeout with 400ms/1200ms backoff over 3 attempts and described
  // that as "a few seconds at worst". It is 4000+400+4000+1200+4000 = 13,600ms — thirteen seconds of dead air
  // before a user can start speaking, which is its own product defect. These assert the bound instead of
  // trusting the description.
  it('the worst-case schedule fits inside the total budget', () => {
    const { worstCaseMs } = freshnessSchedule();
    expect(worstCaseMs).toBeLessThanOrEqual(FRESHNESS_BUDGET_MS);
  });

  it('the budget is the PO-required ceiling', () => {
    expect(FRESHNESS_BUDGET_MS).toBeLessThanOrEqual(4000);
  });

  it('no single attempt or backoff can exceed the whole budget', () => {
    const { attempts, backoffs } = freshnessSchedule();
    expect(attempts.length).toBeGreaterThan(1);           // still retries; not a single-shot check
    for (const d of [...attempts, ...backoffs]) expect(d).toBeLessThanOrEqual(FRESHNESS_BUDGET_MS);
  });

  it('rejects the ORIGINAL schedule that shipped the 13.6s regression', () => {
    // Regression fence: recompute the old shape and prove it would fail this suite.
    const oldWorstCase = 4000 + 400 + 4000 + 1200 + 4000;
    expect(oldWorstCase).toBe(13600);
    expect(oldWorstCase).toBeGreaterThan(FRESHNESS_BUDGET_MS);
  });
});

describe('#1314 stale-client guard — bounded retry then block', () => {
  beforeEach(() => { vi.stubGlobal('window', { ...globalThis.window, __APP_RELEASE__: SHA_A }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a transient blip does NOT block: it retries and then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue({ ok: true, text: async () => html(SHA_A) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await checkClientFreshness();
    expect(r.status).toBe('fresh');
    expect(r.attempts).toBe(2);           // retried once, then resolved
  });

  it('a persistently unreachable origin BLOCKS after bounded attempts — it does not hang or wave through', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await checkClientFreshness();
    expect(r.status).toBe('unverified');
    expect(canRecord(r.status)).toBe(false);
    expect(r.attempts).toBe(3);           // bounded: three tries, not an indefinite loop
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('the PRE-LOOP guard skips the whole check when the budget is already spent', async () => {
    // NOTE ON WHAT THIS DOES *NOT* PROVE: the clock here expires before any fetch is issued, so this only
    // covers the guard at the top of the loop. The real async deadline — a fetch that hangs until its
    // AbortSignal fires — is proven by the fake-timer test below, not by this one.
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let t = 0;
    const clock = () => { const v = t; t += FRESHNESS_BUDGET_MS; return v; };  // budget gone after one read
    const r = await checkClientFreshness(clock);
    expect(r.status).toBe('unverified');
    expect(r.attempts).toBeLessThan(3);
  });

  it('stops retrying as soon as it gets an answer — a stale answer is an ANSWER, not a failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => html(SHA_B) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await checkClientFreshness();
    expect(r.status).toBe('stale');
    expect(r.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips the network entirely for a local build', async () => {
    vi.stubGlobal('window', { ...globalThis.window, __APP_RELEASE__: 'dev' });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await checkClientFreshness();
    expect(r.status).toBe('local');
    expect(r.attempts).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('#1314 stale-client guard — a HUNG origin is aborted inside the budget', () => {
  // The case that matters in production is not a fetch that rejects (instant) but one that never answers. Only
  // the AbortSignal ends it, so this drives real fake timers against a fetch that hangs until aborted.
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  /** Mimics fetch semantics: never settles on its own; rejects only when the caller's AbortSignal fires. */
  const hungFetch = () => vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort);
  }));

  it('aborts each hung attempt and resolves `unverified` within the total budget', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { ...globalThis.window, __APP_RELEASE__: SHA_A });
    const fetchMock = hungFetch();
    vi.stubGlobal('fetch', fetchMock);

    let settled = false;
    const pending = checkClientFreshness().then((r) => { settled = true; return r; });

    // Nothing may resolve on its own — without the AbortSignal this hangs forever.
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(FRESHNESS_BUDGET_MS);

    // Assert settlement BEFORE awaiting: if the deadline is broken the hung fetch never resolves, and awaiting
    // first would turn a broken deadline into a test-suite hang instead of a legible failure. (Verified by
    // mutation: removing the abort call makes this assertion fail here rather than hanging the run.)
    expect(settled, 'freshness check did not settle within its budget — the abort deadline is not firing').toBe(true);
    const r = await pending;
    expect(r.status).toBe('unverified');
    expect(canRecord(r.status)).toBe(false);
    expect(r.attempts).toBe(3);                       // every attempt ran and was aborted, none hung past its slice
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Each call really was given an AbortSignal, and each was aborted — otherwise nothing above could end.
    for (const call of fetchMock.mock.calls) {
      const signal = (call[1] as { signal?: AbortSignal } | undefined)?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal!.aborted).toBe(true);
    }
  });

  it('does NOT resolve early — the retries genuinely occupy the budget', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { ...globalThis.window, __APP_RELEASE__: SHA_A });
    vi.stubGlobal('fetch', hungFetch());

    let settled = false;
    const pending = checkClientFreshness().then((r) => { settled = true; return r; });

    // After the first attempt's slice alone, the check must still be retrying rather than giving up.
    await vi.advanceTimersByTimeAsync(1200);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(FRESHNESS_BUDGET_MS);
    expect(settled, 'freshness check did not settle within its budget').toBe(true);
    await pending;
  });

  it('a hung origin that recovers mid-schedule still yields a real answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { ...globalThis.window, __APP_RELEASE__: SHA_A });
    let call = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      call++;
      if (call === 1) {
        return new Promise((_res, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return Promise.resolve({ ok: true, text: async () => html(SHA_B) });
    }));

    let settled = false;
    const pending = checkClientFreshness().then((v) => { settled = true; return v; });
    await vi.advanceTimersByTimeAsync(FRESHNESS_BUDGET_MS);
    expect(settled, 'freshness check did not settle within its budget').toBe(true);
    const r = await pending;

    // First attempt hung and was aborted; the second answered — and a STALE answer is still an answer.
    expect(r.attempts).toBe(2);
    expect(r.status).toBe('stale');
  });
});

describe('#1314 stale-client guard — user-facing copy', () => {
  it('every blocking status has a distinct message, and permitted statuses have none', () => {
    expect(blockedMessage('stale')).toBe(STALE_CLIENT_MESSAGE);
    expect(blockedMessage('unverified')).toBe(UNVERIFIED_CLIENT_MESSAGE);
    expect(blockedMessage('fresh')).toBeNull();
    expect(blockedMessage('local')).toBeNull();
    expect(STALE_CLIENT_MESSAGE).not.toBe(UNVERIFIED_CLIENT_MESSAGE);
  });

  it('names the action without exposing build ids or asking for devtools', () => {
    for (const msg of [STALE_CLIENT_MESSAGE, UNVERIFIED_CLIENT_MESSAGE]) {
      expect(msg).toMatch(/reload/i);
      // Word-boundaried on purpose: a naive /SHA/i also matches "SpeakSharp".
      expect(msg).not.toMatch(/\b(console|devtools|sha|commit|build id)\b/i);
      expect(msg).not.toContain('__APP_RELEASE__');
      expect(msg).not.toMatch(/\b(bundle|cache|deploy(ment)?)\b/i);
    }
  });

  it('the unverified message points at connectivity, which is the actionable cause', () => {
    expect(UNVERIFIED_CLIENT_MESSAGE).toMatch(/connection/i);
  });
});
