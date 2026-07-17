// Resilient GitHub API GET for the ops-health dashboard.
//
// Why this exists: the ops-health GitHub row used a single, no-retry fetch and collapsed every failure
// into `github=<status>`. A single transient upstream 503 therefore produced a full "product emergency"
// RED with no diagnostics (no request-id, no rate-limit headers). This helper adds *bounded* resilience
// — it does NOT "retry until green":
//   - at most `maxAttempts` (default 3) total attempts;
//   - bounded exponential backoff with full jitter, capped at `maxBackoffMs`;
//   - a per-attempt timeout AND a hard total time budget;
//   - fetch/sleep/random/clock/timers injected so behavior is deterministic under test;
//   - GitHub rate-limit headers honored (Retry-After, x-ratelimit-remaining/reset) — never busy-retry;
//   - non-transient failures (400/404/401/permission-403) fail immediately as RED, never retried;
//   - every failed attempt emits sanitized diagnostics (endpoint label, attempt, status, request-id,
//     retry-after, rate-limit trio, truncated error) — and NEVER the Authorization header or token.
//
// GET-only by construction: only idempotent reads are retried.

export const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

export const Classification = Object.freeze({
  OK: 'OK', // succeeded on the first attempt
  RECOVERED: 'RECOVERED', // failed transiently, then succeeded within budget (non-gating yellow)
  RED: 'RED', // exhausted retries, or a non-retryable/permission/auth failure
  RATE_LIMITED: 'RATE_LIMITED', // required rate-limit wait exceeds the health-check budget
});

export class GithubOpsError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'GithubOpsError';
    this.classification = info.classification ?? Classification.RED;
    this.status = info.status ?? null;
    this.attempts = info.attempts ?? null;
    this.label = info.label ?? 'github';
    this.diagnostics = info.diagnostics ?? [];
  }
}

const DEFAULTS = {
  maxAttempts: 3,
  perAttemptTimeoutMs: 15_000,
  totalBudgetMs: 30_000,
  baseBackoffMs: 500,
  maxBackoffMs: 4_000,
};

function sanitize(text) {
  return String(text ?? '')
    .replace(/gh[posru]_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}

function truncate(text, max = 200) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function headerValue(headers, name) {
  if (!headers || typeof headers.get !== 'function') return null;
  const value = headers.get(name);
  return value == null ? null : value;
}

function numericHeader(headers, name) {
  const raw = headerValue(headers, name);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function attemptDiagnostics(label, attempt, { status, headers, errorMessage }) {
  return {
    label,
    attempt,
    status: status ?? null,
    requestId: headerValue(headers, 'x-github-request-id'),
    retryAfter: headerValue(headers, 'retry-after'),
    rateLimitLimit: headerValue(headers, 'x-ratelimit-limit'),
    rateLimitRemaining: headerValue(headers, 'x-ratelimit-remaining'),
    rateLimitReset: headerValue(headers, 'x-ratelimit-reset'),
    error: errorMessage ? truncate(sanitize(errorMessage)) : null,
  };
}

function formatDiagnostic(diag) {
  return (
    `[ops-health][github][${diag.label}] attempt=${diag.attempt} status=${diag.status ?? 'n/a'} ` +
    `request-id=${diag.requestId ?? 'n/a'} retry-after=${diag.retryAfter ?? 'n/a'} ` +
    `ratelimit=${diag.rateLimitRemaining ?? 'n/a'}/${diag.rateLimitLimit ?? 'n/a'} ` +
    `reset=${diag.rateLimitReset ?? 'n/a'}${diag.error ? ` error=${diag.error}` : ''}`
  );
}

function terminalError(classification, label, reason, attempt, diagnostics) {
  const last = diagnostics[diagnostics.length - 1] ?? {};
  // Status/rate-limit reflect the final (terminal) attempt, but surface a request-id from the most
  // recent attempt that carried one — so a RED is always traceable to GitHub even if the last attempt
  // returned a bare 5xx with no headers.
  const requestId = [...diagnostics].reverse().find((d) => d.requestId != null)?.requestId ?? null;
  const message =
    `GitHub ${label}: ${classification} — ${sanitize(reason)} ` +
    `[attempts=${attempt} status=${last.status ?? 'n/a'} request-id=${requestId ?? 'n/a'} ` +
    `retry-after=${last.retryAfter ?? 'n/a'} ` +
    `ratelimit=${last.rateLimitRemaining ?? 'n/a'}/${last.rateLimitLimit ?? 'n/a'} reset=${last.rateLimitReset ?? 'n/a'}]`;
  return new GithubOpsError(message, {
    classification,
    status: last.status ?? null,
    attempts: attempt,
    label,
    diagnostics,
  });
}

// Returns the required wait (ms) if `headers` indicate rate limiting, else null (not rate limited).
// GitHub secondary limits => `Retry-After`; primary limits => `x-ratelimit-remaining: 0` + `x-ratelimit-reset` (epoch s).
function rateLimitWaitMs(headers, nowMs) {
  const retryAfter = numericHeader(headers, 'retry-after');
  if (retryAfter != null) return Math.max(0, retryAfter * 1000);
  const remaining = numericHeader(headers, 'x-ratelimit-remaining');
  const reset = numericHeader(headers, 'x-ratelimit-reset');
  if (remaining === 0 && reset != null) return Math.max(0, reset * 1000 - nowMs);
  return null;
}

function backoffMs(attempt, { baseBackoffMs, maxBackoffMs }, random) {
  const ceiling = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 1));
  // Full jitter: uniformly in [0, ceiling].
  return Math.floor(random() * ceiling);
}

/**
 * Resiliently GET a GitHub API URL. Resolves to
 *   { ok:true, status, attempts, recovered, classification, body, diagnostics }
 * on success, or throws a `GithubOpsError` (with classification RED or RATE_LIMITED) on terminal failure.
 *
 * @param {string} url absolute https://api.github.com/... URL
 * @param {object} opts { label, token, maxAttempts, perAttemptTimeoutMs, totalBudgetMs, baseBackoffMs, maxBackoffMs, headers }
 * @param {object} deps { fetch, sleep, random, now, setTimer, clearTimer, onDiagnostic } — all injectable for tests
 */
export async function githubGet(url, opts = {}, deps = {}) {
  const label = opts.label ?? 'github';
  const token = opts.token;
  const config = {
    maxAttempts: opts.maxAttempts ?? DEFAULTS.maxAttempts,
    perAttemptTimeoutMs: opts.perAttemptTimeoutMs ?? DEFAULTS.perAttemptTimeoutMs,
    totalBudgetMs: opts.totalBudgetMs ?? DEFAULTS.totalBudgetMs,
    baseBackoffMs: opts.baseBackoffMs ?? DEFAULTS.baseBackoffMs,
    maxBackoffMs: opts.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
  };
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const onDiagnostic = deps.onDiagnostic ?? ((diag) => console.warn(formatDiagnostic(diag)));

  const start = now();
  const diagnostics = [];

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, config.perAttemptTimeoutMs);

    let response = null;
    let networkError = null;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opts.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      networkError = error;
    } finally {
      clearTimer(timer);
    }

    if (response && response.ok) {
      const body = await (typeof response.json === 'function' ? response.json().catch(() => null) : Promise.resolve(null));
      return {
        ok: true,
        status: response.status,
        attempts: attempt,
        recovered: attempt > 1,
        classification: attempt > 1 ? Classification.RECOVERED : Classification.OK,
        body,
        diagnostics,
      };
    }

    const status = response ? response.status : null;
    const isTimeout = timedOut || (networkError && (networkError.name === 'AbortError' || networkError.name === 'TimeoutError'));
    const errorMessage = networkError
      ? isTimeout
        ? `timeout after ${config.perAttemptTimeoutMs}ms`
        : String(networkError?.message ?? networkError)
      : null;
    const diag = attemptDiagnostics(label, attempt, { status, headers: response?.headers, errorMessage });
    diagnostics.push(diag);
    onDiagnostic(diag);

    // ── Non-retryable, terminal RED (report immediately) ──────────────────────
    if (status === 400 || status === 404) {
      throw terminalError(Classification.RED, label, `request error ${status}`, attempt, diagnostics);
    }
    if (status === 401) {
      throw terminalError(Classification.RED, label, 'authentication failure (401)', attempt, diagnostics);
    }

    // ── Rate limiting (403 secondary / 429 / primary-limit) ───────────────────
    if (status === 403 || status === 429) {
      const waitFromHeaders = rateLimitWaitMs(response.headers, now());
      const isRateLimited = status === 429 || waitFromHeaders != null;
      if (status === 403 && !isRateLimited) {
        // A 403 without any rate-limit signal is a real permission failure — do NOT assume rate limiting.
        throw terminalError(Classification.RED, label, 'permission failure (403, not rate limit)', attempt, diagnostics);
      }
      const requiredWait = waitFromHeaders != null ? waitFromHeaders : backoffMs(attempt, config, random);
      const elapsed = now() - start;
      if (attempt >= config.maxAttempts || elapsed + requiredWait > config.totalBudgetMs) {
        // Required wait exceeds the health-check budget: fail as RATE_LIMITED rather than wait or hammer.
        throw terminalError(
          Classification.RATE_LIMITED,
          label,
          `rate limited; required wait ${requiredWait}ms exceeds health-check budget`,
          attempt,
          diagnostics,
        );
      }
      await sleep(requiredWait);
      continue;
    }

    // ── Transient, retryable (network error, timeout, 408/5xx) ────────────────
    const retryable = isTimeout || networkError != null || (status != null && RETRYABLE_STATUS.has(status));
    if (!retryable) {
      throw terminalError(Classification.RED, label, `non-retryable status ${status ?? 'unknown'}`, attempt, diagnostics);
    }
    if (attempt >= config.maxAttempts) {
      throw terminalError(
        Classification.RED,
        label,
        `exhausted after ${attempt} attempts (last ${status ?? errorMessage})`,
        attempt,
        diagnostics,
      );
    }
    const wait = backoffMs(attempt, config, random);
    if (now() - start + wait > config.totalBudgetMs) {
      throw terminalError(
        Classification.RED,
        label,
        `time budget exhausted before retry (last ${status ?? errorMessage})`,
        attempt,
        diagnostics,
      );
    }
    await sleep(wait);
  }

  // Unreachable in practice (the loop returns or throws), but keep a definite terminal.
  throw terminalError(Classification.RED, label, 'exhausted', config.maxAttempts, diagnostics);
}
