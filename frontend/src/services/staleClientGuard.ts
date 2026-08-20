import logger from '@/lib/logger';

/**
 * #1314 launch bar: **0 silent stale-client execution.**
 *
 * A long-open tab keeps running the bundle it loaded, indefinitely. Vercel serves content-hashed assets, so an
 * old tab never picks up a new deploy on its own — it just keeps working, against a contract that has since
 * changed. That is not hypothetical: the 2026-08-19 real-device run was made by a tab holding a pre-cutover
 * bundle, which called the retained legacy completion overload and produced a session with no next action and no
 * filler metrics. Nothing in the product told the user, and nothing stopped the recording.
 *
 * This guard closes that hole at the only place it matters — BEFORE a recording starts. A user must never be
 * asked to "just reload"; the product detects the situation itself and says so plainly.
 *
 * FAIL-CLOSED (PO ruling 2026-08-19). An earlier revision let an unverifiable production client proceed, on the
 * reasoning that refusing to record cannot make an undetectable mismatch detectable. That was overruled, and the
 * ruling is right: while the legacy transcript-writing RPC overload remains callable, letting an UNVERIFIABLE
 * production client record recreates precisely the hazard this guard exists to prevent. An unverified production
 * client is therefore blocked after bounded retries — "we could not check" is not permission.
 *
 *   fresh      confirmed match                              -> proceed
 *   stale      confirmed mismatch                           -> block, ask for a reload
 *   unverified real release id, but no answer after retries -> BLOCK, connectivity/refresh message
 *   local      no real release id (dev/preview build)       -> proceed; there is nothing to compare against
 */

export type ClientFreshness = 'fresh' | 'stale' | 'unverified' | 'local';

export interface FreshnessResult {
  status: ClientFreshness;
  /** Release id of the bundle currently executing in this tab. */
  running: string | null;
  /** Release id the origin is serving right now, when it could be read. */
  deployed: string | null;
  /** How many lookup attempts were made (0 for a local build, which skips the network entirely). */
  attempts: number;
}

/** Release ids that mean "not a real deployed build" — local dev, preview shells, unset. */
const NON_RELEASE_IDS = new Set(['', 'dev', 'development', 'local', 'undefined', 'null']);

export const isRealReleaseId = (id: string | null | undefined): id is string =>
  typeof id === 'string' && !NON_RELEASE_IDS.has(id.trim().toLowerCase());

/**
 * Extract the release id from an index.html document. The release-inject Vite plugin writes exactly
 * `window.__APP_RELEASE__="<id>"` into the head (see frontend/vite.config.mjs), deliberately as HTML rather
 * than a JS `define`, so the volatile SHA never rotates chunk hashes.
 *
 * Kept pure and exported so the parse is unit-testable without a network, and coupled to the plugin by
 * tests/deps/release-marker-contract.test.ts.
 */
export function parseReleaseFromHtml(html: string): string | null {
  const m = /window\.__APP_RELEASE__\s*=\s*["']([^"']*)["']/.exec(html);
  const id = m?.[1]?.trim();
  return id ? id : null;
}

/**
 * Read the release the origin is serving NOW. Uses `cache: 'reload'` so the request bypasses the HTTP cache —
 * without it we would re-read the very stale copy we are trying to detect, and always conclude "fresh".
 */
export async function fetchDeployedRelease(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch('/index.html', { cache: 'reload', credentials: 'omit', signal });
    if (!res.ok) return null;
    return parseReleaseFromHtml(await res.text());
  } catch {
    return null; // offline / blocked / aborted -> unresolved, never "fresh"
  }
}

/** Pure decision, separated from I/O so every branch is directly testable. */
export function classifyFreshness(running: string | null, deployed: string | null): ClientFreshness {
  if (!isRealReleaseId(running)) return 'local';      // nothing to compare against
  if (!isRealReleaseId(deployed)) return 'unverified'; // production build we could not verify -> fail closed
  return running === deployed ? 'fresh' : 'stale';
}

/** Only these statuses may start a recording. */
export const canRecord = (status: ClientFreshness): boolean => status === 'fresh' || status === 'local';

/**
 * TOTAL wall-clock budget for the whole freshness check, across every attempt AND every backoff.
 *
 * This is a HARD deadline, not a per-attempt timeout. The first revision set a 4s per-attempt timeout with
 * 400ms/1200ms backoff over 3 attempts and described that as "a few seconds at worst" — it is
 * 4000+400+4000+1200+4000 = 13,600ms. Thirteen seconds of dead air before a user can start speaking is its own
 * product defect, so the budget is now enforced as a single deadline that the schedule cannot outrun.
 */
export const FRESHNESS_BUDGET_MS = 4000;
const MAX_ATTEMPTS = 3;
const PER_ATTEMPT_CAP_MS = 1200;
const RETRY_BACKOFF_MS = 200;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The attempt/backoff schedule, as pure data, so the worst case is a value a test can assert against the budget
 * rather than a property a reader has to trust. Returns the per-step durations in order.
 */
export function freshnessSchedule(): { attempts: number[]; backoffs: number[]; worstCaseMs: number } {
  const attempts: number[] = [];
  const backoffs: number[] = [];
  let spent = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const remaining = FRESHNESS_BUDGET_MS - spent;
    if (remaining <= 0) break;
    const t = Math.min(PER_ATTEMPT_CAP_MS, remaining);
    attempts.push(t);
    spent += t;
    if (i < MAX_ATTEMPTS - 1 && FRESHNESS_BUDGET_MS - spent > 0) {
      const b = Math.min(RETRY_BACKOFF_MS, FRESHNESS_BUDGET_MS - spent);
      backoffs.push(b);
      spent += b;
    }
  }
  return { attempts, backoffs, worstCaseMs: spent };
}

/**
 * Check whether this tab is running the deployed build.
 *
 * Bounded by FRESHNESS_BUDGET_MS end to end: a transient blip must not block a legitimate recording, but an
 * origin that stays unreachable must not wave one through either — and neither may cost the user more than the
 * budget before they can speak. Retries stop at the first ANSWER, including a stale one, since a stale answer is
 * an answer rather than a failure.
 */
export async function checkClientFreshness(now: () => number = () => Date.now()): Promise<FreshnessResult> {
  const running = (typeof window !== 'undefined' ? window.__APP_RELEASE__ : null) ?? null;

  // A build with no real release id (local dev) has nothing meaningful to compare against; don't spend a fetch.
  if (!isRealReleaseId(running)) return { status: 'local', running, deployed: null, attempts: 0 };

  const started = now();
  const remaining = () => FRESHNESS_BUDGET_MS - (now() - started);

  let deployed: string | null = null;
  let attempts = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (remaining() <= 0) break;
    attempts++;
    const controller = new AbortController();
    // Never let one attempt consume more than the budget that is actually left.
    const timer = setTimeout(() => controller.abort(), Math.min(PER_ATTEMPT_CAP_MS, remaining()));
    try {
      deployed = await fetchDeployedRelease(controller.signal);
    } finally {
      clearTimeout(timer);
    }
    if (deployed !== null) break;
    if (i < MAX_ATTEMPTS - 1 && remaining() > RETRY_BACKOFF_MS) await delay(RETRY_BACKOFF_MS);
  }

  const status = classifyFreshness(running, deployed);
  if (status === 'stale' || status === 'unverified') {
    // Release ids are public build identifiers, not user content — safe to log, and the whole point is that
    // this event is never silent again.
    logger.warn({ running, deployed, attempts, status, elapsedMs: now() - started },
      '[StaleClientGuard] blocking recording — client not verified current');
  }
  return { status, running, deployed, attempts };
}

/** User-facing copy. States the situation and the one action, without exposing build ids or asking for devtools. */
export const STALE_CLIENT_MESSAGE =
  '⛔ This page is running an older version of SpeakSharp. Reload to get the current version before recording — otherwise this session could be saved incorrectly.';

/** Shown when we could not confirm the page is current. Fail-closed: "we could not check" is not permission. */
export const UNVERIFIED_CLIENT_MESSAGE =
  '⛔ Could not confirm this page is up to date. Check your connection and reload before recording — recording now could save this session incorrectly.';

/** The message for a status that is not allowed to record; null when recording is permitted. */
export function blockedMessage(status: ClientFreshness): string | null {
  if (status === 'stale') return STALE_CLIENT_MESSAGE;
  if (status === 'unverified') return UNVERIFIED_CLIENT_MESSAGE;
  return null;
}
