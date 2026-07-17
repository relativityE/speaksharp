// Resilient GitHub API GET for the ops-health dashboard.
//
// Why this exists: the ops-health GitHub row used a single, no-retry fetch and collapsed every failure
// into `github=<status>`. A single transient upstream 503 therefore produced a false product-emergency
// RED with no diagnostics. This helper adds *bounded* resilience — it does NOT "retry until green":
//   - at most `maxAttempts` (default 3) total attempts;
//   - a HARD absolute deadline (shared across the whole GitHub row when passed as `opts.deadline`) so the
//     row can never multiply its budget by the number of sub-checks;
//   - before every attempt: remaining = deadline - now(); if <= 0 → BUDGET_EXHAUSTED; the per-attempt
//     timeout is min(perAttemptTimeoutMs, remaining); a response that arrives after the deadline can NOT
//     become green;
//   - bounded exponential backoff with full jitter for transient retries;
//   - GitHub rate-limit handling: Retry-After / x-ratelimit-remaining=0+reset / secondary-limit body
//     language are honored; an unqualified 429 (no usable headers) uses GitHub's >=60s recommended
//     fallback, which exceeds the health-check budget → RATE_LIMITED immediately (never a 0–500ms backoff);
//   - non-transient failures (400/404/401/permission-403) fail immediately as RED, never retried;
//   - every failed attempt emits sanitized diagnostics (endpoint label, attempt, status, request-id,
//     retry-after, rate-limit trio, sanitized body/error) — and NEVER the Authorization header or token.
//
// GET-only by construction: only idempotent reads are retried.

export const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

// GitHub's own guidance for a 429/secondary limit with no usable headers is to wait at least a minute.
// That exceeds the ops-health budget, so an unqualified 429 is terminal (RATE_LIMITED), never busy-retried.
export const RATE_LIMIT_FALLBACK_MS = 60_000;

const SECONDARY_LIMIT_RE = /secondary rate limit|abuse detection|exceeded a secondary/i;

export const Classification = Object.freeze({
  OK: 'OK', // succeeded on the first attempt
  RECOVERED: 'RECOVERED', // failed transiently, then succeeded within budget (non-gating yellow)
  RED: 'RED', // exhausted retries, or a non-retryable / permission / auth failure
  RATE_LIMITED: 'RATE_LIMITED', // required rate-limit wait exceeds the health-check budget
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED', // hard deadline reached before/while producing a usable result
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

export const BOUNDS = Object.freeze({
  maxAttempts: { min: 1, max: 10, fallback: 3 },
  perAttemptTimeoutMs: { min: 1_000, max: 120_000, fallback: 15_000 },
  totalBudgetMs: { min: 1_000, max: 300_000, fallback: 30_000 },
  baseBackoffMs: { min: 1, max: 10_000, fallback: 500 },
  maxBackoffMs: { min: 1, max: 30_000, fallback: 4_000 },
});

// Validate + clamp a numeric tunable to a finite positive bounded integer; garbage → fallback.
export function clampPositiveInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const floored = Math.floor(n);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}

function resolveConfig(opts) {
  return {
    maxAttempts: clampPositiveInt(opts.maxAttempts, BOUNDS.maxAttempts),
    perAttemptTimeoutMs: clampPositiveInt(opts.perAttemptTimeoutMs, BOUNDS.perAttemptTimeoutMs),
    totalBudgetMs: clampPositiveInt(opts.totalBudgetMs, BOUNDS.totalBudgetMs),
    baseBackoffMs: clampPositiveInt(opts.baseBackoffMs, BOUNDS.baseBackoffMs),
    maxBackoffMs: clampPositiveInt(opts.maxBackoffMs, BOUNDS.maxBackoffMs),
  };
}

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

async function readBodySafe(response) {
  try {
    if (response && typeof response.text === 'function') return await response.text();
    if (response && typeof response.json === 'function') return JSON.stringify(await response.json());
  } catch {
    /* body already consumed or unreadable — diagnostics degrade gracefully */
  }
  return '';
}

function attemptDiagnostics(label, attempt, { status, headers, errorMessage, body }) {
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
    body: body ? truncate(sanitize(body), 300) : null,
  };
}

function formatDiagnostic(diag) {
  return (
    `[ops-health][github][${diag.label}] attempt=${diag.attempt} status=${diag.status ?? 'n/a'} ` +
    `request-id=${diag.requestId ?? 'n/a'} retry-after=${diag.retryAfter ?? 'n/a'} ` +
    `ratelimit=${diag.rateLimitRemaining ?? 'n/a'}/${diag.rateLimitLimit ?? 'n/a'} ` +
    `reset=${diag.rateLimitReset ?? 'n/a'}${diag.error ? ` error=${diag.error}` : ''}${diag.body ? ` body=${diag.body}` : ''}`
  );
}

function terminalError(classification, label, reason, diagnostics) {
  const last = diagnostics[diagnostics.length - 1] ?? {};
  // Status/rate-limit reflect the terminal attempt, but surface a request-id from the most recent attempt
  // that carried one — so a RED is always traceable to GitHub even if the last attempt had no headers.
  const requestId = [...diagnostics].reverse().find((d) => d.requestId != null)?.requestId ?? null;
  const message =
    `GitHub ${label}: ${classification} — ${sanitize(reason)} ` +
    `[attempts=${diagnostics.length} status=${last.status ?? 'n/a'} request-id=${requestId ?? 'n/a'} ` +
    `retry-after=${last.retryAfter ?? 'n/a'} ` +
    `ratelimit=${last.rateLimitRemaining ?? 'n/a'}/${last.rateLimitLimit ?? 'n/a'} reset=${last.rateLimitReset ?? 'n/a'}]`;
  return new GithubOpsError(message, {
    classification,
    status: last.status ?? null,
    attempts: diagnostics.length,
    label,
    diagnostics,
  });
}

// Returns the required wait (ms) if `headers` indicate rate limiting, else null.
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
  return Math.floor(random() * ceiling); // full jitter in [0, ceiling]
}

/**
 * Resiliently GET a GitHub API URL. Resolves to
 *   { ok:true, status, attempts, recovered, classification, body, diagnostics }
 * on success, or throws a `GithubOpsError` on terminal failure (RED / RATE_LIMITED / BUDGET_EXHAUSTED).
 *
 * @param {string} url absolute https://api.github.com/... URL
 * @param {object} opts { label, token, deadline?, maxAttempts, perAttemptTimeoutMs, totalBudgetMs, baseBackoffMs, maxBackoffMs, headers }
 *                       `deadline` (absolute, in the injected clock's units) is shared across a row when supplied.
 * @param {object} deps { fetch, sleep, random, now, setTimer, clearTimer, onDiagnostic } — all injectable for tests
 */
export async function githubGet(url, opts = {}, deps = {}) {
  const label = opts.label ?? 'github';
  const token = opts.token;
  const config = resolveConfig(opts);
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const onDiagnostic = deps.onDiagnostic ?? ((diag) => console.warn(formatDiagnostic(diag)));

  const start = now();
  const deadline = opts.deadline ?? start + config.totalBudgetMs;
  const diagnostics = [];

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    // ── Hard deadline: never start an attempt with no budget left ──────────────
    const remaining = deadline - now();
    if (remaining <= 0) {
      const diag = attemptDiagnostics(label, attempt, { status: null, errorMessage: 'budget exhausted before attempt' });
      diagnostics.push(diag);
      onDiagnostic(diag);
      throw terminalError(Classification.BUDGET_EXHAUSTED, label, 'time budget exhausted before attempt', diagnostics);
    }
    const attemptTimeoutMs = Math.min(config.perAttemptTimeoutMs, remaining);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, attemptTimeoutMs);

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
      // A success that lands after the hard deadline cannot become green.
      if (now() > deadline) {
        const diag = attemptDiagnostics(label, attempt, { status: response.status, headers: response.headers, errorMessage: 'response arrived after deadline' });
        diagnostics.push(diag);
        onDiagnostic(diag);
        throw terminalError(Classification.BUDGET_EXHAUSTED, label, 'response arrived after hard deadline', diagnostics);
      }
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
        ? `timeout after ${attemptTimeoutMs}ms`
        : String(networkError?.message ?? networkError)
      : null;

    // For 403/429 read the (small) error body — GitHub signals secondary limits in the body text.
    const bodyText = status === 403 || status === 429 ? await readBodySafe(response) : '';
    const diag = attemptDiagnostics(label, attempt, { status, headers: response?.headers, errorMessage, body: bodyText });
    diagnostics.push(diag);
    onDiagnostic(diag);

    // ── Non-retryable, terminal RED (report immediately) ──────────────────────
    if (status === 400 || status === 404) {
      throw terminalError(Classification.RED, label, `request error ${status}`, diagnostics);
    }
    if (status === 401) {
      throw terminalError(Classification.RED, label, 'authentication failure (401)', diagnostics);
    }

    // ── Rate limiting (403 secondary / 429 / primary limit) ───────────────────
    if (status === 403 || status === 429) {
      const headerWait = rateLimitWaitMs(response.headers, now());
      const secondary = SECONDARY_LIMIT_RE.test(bodyText);
      const isRateLimited = status === 429 || headerWait != null || secondary;
      if (status === 403 && !isRateLimited) {
        // A 403 with no rate-limit evidence is a real permission failure — never assume rate limiting.
        throw terminalError(Classification.RED, label, 'permission failure (403, no rate-limit evidence)', diagnostics);
      }
      // Unqualified 429 / secondary-without-headers → GitHub's >=60s fallback, which exceeds the budget.
      const requiredWait = headerWait != null ? headerWait : RATE_LIMIT_FALLBACK_MS;
      const budgetLeft = deadline - now();
      if (attempt >= config.maxAttempts || requiredWait > budgetLeft) {
        throw terminalError(
          Classification.RATE_LIMITED,
          label,
          `rate limited; required wait ${requiredWait}ms exceeds remaining budget ${Math.max(0, budgetLeft)}ms`,
          diagnostics,
        );
      }
      await sleep(requiredWait);
      continue;
    }

    // ── Transient, retryable (network error, timeout, 408/5xx) ────────────────
    const retryable = isTimeout || networkError != null || (status != null && RETRYABLE_STATUS.has(status));
    if (!retryable) {
      throw terminalError(Classification.RED, label, `non-retryable status ${status ?? 'unknown'}`, diagnostics);
    }
    if (attempt >= config.maxAttempts) {
      throw terminalError(Classification.RED, label, `exhausted after ${attempt} attempts (last ${status ?? errorMessage})`, diagnostics);
    }
    const wait = backoffMs(attempt, config, random);
    if (wait > deadline - now()) {
      throw terminalError(Classification.BUDGET_EXHAUSTED, label, `time budget exhausted before retry (last ${status ?? errorMessage})`, diagnostics);
    }
    await sleep(wait);
  }

  // Unreachable in practice (the loop returns or throws), but keep a definite terminal.
  throw terminalError(Classification.RED, label, 'exhausted', diagnostics);
}
