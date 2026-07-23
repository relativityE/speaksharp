/**
 * Stale-deployment chunk-load recovery.
 *
 * A long-lived authenticated tab still runs the bundle it booted with. After a new deployment, that old
 * tab may lazily `import()` a chunk whose URL no longer exists on the server. Because the SPA fallback
 * historically rewrote every filesystem miss to `index.html`, the browser received HTML for a `.js`
 * request and threw:
 *   "Failed to fetch dynamically imported module" / "Expected a JavaScript module but received text/html".
 * Vite also emits a `vite:preloadError` event for this.
 *
 * Recovery: reload the CURRENT url ONCE so the browser fetches the current `index.html` + asset graph,
 * preserving route + query + hash + the authenticated session. A time-bounded sessionStorage guard
 * prevents reload loops; if a reload does not fix it (second failure inside the window), we surface a
 * specific "SpeakSharp was updated" message with a "Reload latest version" action — never the generic
 * error page. The guard is cleared once the app boots successfully.
 */

const GUARD_KEY = 'ss_stale_chunk_recovery';
/** Within this window, a repeat failure means the reload did NOT fix it → stop (loop guard). */
export const GUARD_WINDOW_MS = 20_000;
export const RECOVERY_MESSAGE = 'SpeakSharp was updated. Reload the page to continue.';

export interface StaleChunkGuard {
  /** epoch ms of the most recent recovery attempt */
  at: number;
  /** how many failures have occurred inside the current window */
  count: number;
}

/** The dynamic-import / module-load failure shapes this recovers from (Chromium, Firefox, WebKit + Vite
 * variants). Deliberately specific — a generic TypeError must NOT match (that is a real app crash). */
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Failed to load module script|Importing a module script failed|Expected a JavaScript(-or-Wasm)? module( script)? but (the server responded with|received)|dynamically imported module/i;

export function isChunkLoadError(message: unknown): boolean {
  const text = typeof message === 'string' ? message : String((message as { message?: string })?.message ?? message ?? '');
  return CHUNK_ERROR_RE.test(text);
}

/** True while a stale-chunk recovery has been claimed (a reload is imminent). The ErrorBoundary uses this
 * so the DOWNSTREAM React.lazy symptom ("Cannot read properties of undefined (reading 'default')") — which
 * is not itself a recognizable chunk message — is not shown as a generic crash when recovery is underway. */
export function isStaleChunkRecoveryInFlight(): boolean {
  return recoveryInFlight;
}

function readGuard(store: Storage): StaleChunkGuard | null {
  try {
    const raw = store.getItem(GUARD_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as StaleChunkGuard;
    return typeof g?.at === 'number' && typeof g?.count === 'number' ? g : null;
  } catch {
    return null;
  }
}

function writeGuard(store: Storage, g: StaleChunkGuard): void {
  try { store.setItem(GUARD_KEY, JSON.stringify(g)); } catch { /* storage unavailable — best effort */ }
}

export function clearStaleChunkGuard(store: Storage | undefined = safeSessionStorage()): void {
  try { store?.removeItem(GUARD_KEY); } catch { /* ignore */ }
}

/**
 * Pure decision (unit-testable): given the current guard and `now`, do we reload once more, or have we
 * already reloaded within the window (→ stop and show recovery UI)? Returns the next guard to persist.
 */
export function decideRecovery(guard: StaleChunkGuard | null, now: number): {
  action: 'reload' | 'recover';
  nextGuard: StaleChunkGuard;
} {
  const withinWindow = !!guard && now - guard.at < GUARD_WINDOW_MS && now >= guard.at;
  const count = withinWindow ? guard!.count + 1 : 1;
  // First failure in a fresh window → reload once. A second failure inside the window means the reload
  // did not resolve it → do NOT reload again (loop), show the recovery UI instead.
  return { action: count >= 2 ? 'recover' : 'reload', nextGuard: { at: now, count } };
}

function safeSessionStorage(): Storage | undefined {
  try { return typeof window !== 'undefined' ? window.sessionStorage : undefined; } catch { return undefined; }
}

let recoveryUiShown = false;

/** Minimal DOM overlay (does NOT depend on React, which may be in a broken state). */
export function showStaleChunkRecoveryUI(doc: Document = document): void {
  if (recoveryUiShown || doc.getElementById('ss-stale-chunk-recovery')) return;
  recoveryUiShown = true;
  const host = doc.createElement('div');
  host.id = 'ss-stale-chunk-recovery';
  host.setAttribute('role', 'alertdialog');
  host.setAttribute('aria-label', 'SpeakSharp was updated');
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
    'background:#0f172acc;backdrop-filter:blur(2px);font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px';
  host.innerHTML =
    '<div style="max-width:420px;width:100%;background:#fff;border-radius:12px;padding:28px;box-shadow:0 20px 60px rgba(15,23,42,.28);text-align:center">' +
    '<h2 style="margin:0 0 10px;font-size:19px;font-weight:700;color:#16213e">SpeakSharp was updated</h2>' +
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#45526f">${RECOVERY_MESSAGE}</p>` +
    '<button id="ss-stale-chunk-reload" style="cursor:pointer;border:0;border-radius:8px;background:#08746f;color:#fff;font-weight:600;font-size:15px;padding:11px 20px">Reload latest version</button>' +
    '</div>';
  doc.body.appendChild(host);
  doc.getElementById('ss-stale-chunk-reload')?.addEventListener('click', () => {
    clearStaleChunkGuard();
    window.location.reload();
  });
}

/**
 * Atomic in-flight claim. A single failed import() surfaces BOTH as `vite:preloadError` AND via React's
 * error boundary (and possibly `error`/`unhandledrejection`). The FIRST recognized failure claims the
 * recovery attempt; every later invocation before navigation or a successful boot is a no-op and does NOT
 * touch the session guard. It is reset (a) implicitly by the page reload it triggers, and (b) explicitly
 * by markStaleChunkAppBooted() on a successful boot. A genuine failure AFTER the reload lands on a fresh
 * module (claim reset) and, because the persisted guard survived the reload, escalates to the recovery UI.
 */
let recoveryInFlight = false;

/**
 * Perform recovery for a detected stale-chunk failure: reload once (guarded), or show the recovery UI on
 * a repeat. Preserves the current URL + session (a plain reload keeps path/query/hash and cookies).
 * Returns 'ignored' when a recovery for this page-life is already in flight (deduped).
 */
export function recoverFromStaleChunk(now: number = Date.now()): 'reload' | 'recover' | 'ignored' {
  if (recoveryInFlight) return 'ignored';
  recoveryInFlight = true;

  const store = safeSessionStorage();
  const { action, nextGuard } = decideRecovery(store ? readGuard(store) : null, now);
  if (store) writeGuard(store, nextGuard);
  if (action === 'reload') {
    window.location.reload();
  } else {
    showStaleChunkRecoveryUI();
  }
  return action;
}

/** Call once the app has booted successfully — a fresh graph loaded, so the in-flight claim + loop guard
 * reset. No-op while the recovery UI is showing (that state is a failed recovery, not a successful boot). */
export function markStaleChunkAppBooted(): void {
  if (recoveryUiShown) return;
  recoveryInFlight = false;
  clearStaleChunkGuard();
}

/**
 * Install global listeners BEFORE app initialization. Handles Vite's `vite:preloadError` and the raw
 * dynamic-import rejection/error shapes, calling preventDefault so the known deployment condition never
 * becomes an uncaught error / generic error page.
 */
export function installStaleChunkRecovery(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    recoverFromStaleChunk();
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      event.preventDefault();
      recoverFromStaleChunk();
    }
  });

  window.addEventListener('error', (event) => {
    if (isChunkLoadError(event.message) || isChunkLoadError(event.error)) {
      event.preventDefault();
      recoverFromStaleChunk();
    }
  });
}
