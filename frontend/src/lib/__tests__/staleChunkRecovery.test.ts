import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fresh module per test resets the in-flight claim / recovery-UI flags (as a real page reload would).
type Mod = typeof import('../staleChunkRecovery');
let mod: Mod;
let reloadSpy: ReturnType<typeof vi.fn>;

/** Re-import the module WITHOUT clearing sessionStorage — models a page reload (fresh JS, persisted guard). */
async function reimportAsAfterReload(): Promise<Mod> {
  vi.resetModules();
  return import('../staleChunkRecovery');
}

beforeEach(async () => {
  vi.resetModules();
  window.sessionStorage.clear();
  document.body.innerHTML = '';
  reloadSpy = vi.fn();
  Object.defineProperty(window.location, 'reload', { configurable: true, value: reloadSpy });
  mod = await import('../staleChunkRecovery');
});

const GUARD = 'ss_stale_chunk_recovery';

describe('isChunkLoadError', () => {
  it('detects the known stale-deployment dynamic-import failures (Chromium/Firefox/WebKit + Vite)', () => {
    for (const m of [
      'Failed to fetch dynamically imported module: https://app/assets/x.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'Expected a JavaScript module script but the server responded with a MIME type of text/html',
      'Expected a JavaScript module but received text/html',
      // The exact Chromium message observed in the rollover test:
      'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
    ]) {
      expect(mod.isChunkLoadError(m)).toBe(true);
      expect(mod.isChunkLoadError(new Error(m))).toBe(true);
    }
  });
  it('does NOT match unrelated errors (incl. the generic React.lazy "default" TypeError)', () => {
    expect(mod.isChunkLoadError('TypeError: undefined is not a function')).toBe(false);
    expect(mod.isChunkLoadError("Cannot read properties of undefined (reading 'default')")).toBe(false);
    expect(mod.isChunkLoadError(new Error('boom'))).toBe(false);
    expect(mod.isChunkLoadError(undefined)).toBe(false);
  });
});

describe('isStaleChunkRecoveryInFlight (lets the boundary suppress the downstream symptom)', () => {
  it('false initially, true after a recovery is claimed, and resets on the reload (fresh module)', async () => {
    expect(mod.isStaleChunkRecoveryInFlight()).toBe(false);
    mod.recoverFromStaleChunk(1000);
    expect(mod.isStaleChunkRecoveryInFlight()).toBe(true);
    // The claim resets when the reload replaces the page — a new module instance starts clean.
    const after = await reimportAsAfterReload();
    expect(after.isStaleChunkRecoveryInFlight()).toBe(false);
  });
});

describe('decideRecovery (pure loop guard)', () => {
  it('first failure → reload; second inside window → recover; after window → reload', () => {
    expect(mod.decideRecovery(null, 1000)).toEqual({ action: 'reload', nextGuard: { at: 1000, count: 1 } });
    expect(mod.decideRecovery({ at: 1000, count: 1 }, 6000)).toEqual({ action: 'recover', nextGuard: { at: 6000, count: 2 } });
    const after = 1000 + mod.GUARD_WINDOW_MS + 1;
    expect(mod.decideRecovery({ at: 1000, count: 2 }, after)).toEqual({ action: 'reload', nextGuard: { at: after, count: 1 } });
  });
});

describe('atomic in-flight claim — one failure handled once', () => {
  it('first failure reloads once and preserves the URL (reload, never assign)', () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window.location, 'assign', { configurable: true, value: assignSpy });
    expect(mod.recoverFromStaleChunk(1000)).toBe('reload');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(assignSpy).not.toHaveBeenCalled();
    expect(JSON.parse(window.sessionStorage.getItem(GUARD)!)).toEqual({ at: 1000, count: 1 });
  });

  it('vite:preloadError + ErrorBoundary for the SAME failure → reload once, guard stays count 1', () => {
    expect(mod.recoverFromStaleChunk(1000)).toBe('reload');   // vite:preloadError
    expect(mod.recoverFromStaleChunk(1000)).toBe('ignored');  // ErrorBoundary, same failure
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.sessionStorage.getItem(GUARD)!).count).toBe(1);
    expect(document.getElementById('ss-stale-chunk-recovery')).toBeNull(); // not escalated
  });

  it('a duplicate in a microtask is deduped', async () => {
    mod.recoverFromStaleChunk(1000);
    await Promise.resolve();
    expect(mod.recoverFromStaleChunk(1000)).toBe('ignored');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('a duplicate in a later macrotask (before navigation) is deduped', async () => {
    mod.recoverFromStaleChunk(1000);
    await new Promise((r) => setTimeout(r, 5));
    expect(mod.recoverFromStaleChunk(1050)).toBe('ignored');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('retain-until-expiry guard + escalation across a reload', () => {
  it('after the one reload, a SECOND genuine failure → no reload, shows the specific recovery UI', async () => {
    mod.recoverFromStaleChunk(1000);        // reload; guard count 1 persisted in sessionStorage
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    // Simulate the reload: fresh module (in-flight reset), sessionStorage guard PRESERVED (not boot-cleared).
    const after = await reimportAsAfterReload();
    const action = after.recoverFromStaleChunk(1000 + 3_000); // still inside the window
    expect(action).toBe('recover');
    expect(reloadSpy).toHaveBeenCalledTimes(1); // NO second reload (no loop)
    const ui = document.getElementById('ss-stale-chunk-recovery');
    expect(ui?.textContent).toContain(after.RECOVERY_MESSAGE);
    (document.getElementById('ss-stale-chunk-reload') as HTMLButtonElement).click();
    expect(reloadSpy).toHaveBeenCalledTimes(2);
    expect(window.sessionStorage.getItem(GUARD)).toBeNull(); // the action clears the guard
  });

  it('a DELAYED second failure (well after two animation frames, still within the window) → recovery UI, no reload', async () => {
    mod.recoverFromStaleChunk(1000);
    // Model the reloaded page reaching "two frames" and beyond WITHOUT any boot-clear of the guard.
    const after = await reimportAsAfterReload();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // two frames elapse
    await new Promise((r) => setTimeout(r, 30)); // ...and well beyond
    // The failure surfaces ~6s later (still < GUARD_WINDOW_MS): the guard must NOT have been frame-cleared.
    const action = after.recoverFromStaleChunk(1000 + 6_000);
    expect(action).toBe('recover');
    expect(reloadSpy).toHaveBeenCalledTimes(1); // still exactly one reload — the 2-frame heuristic is gone
    expect(document.getElementById('ss-stale-chunk-recovery')).not.toBeNull();
  });

  it('a failure AFTER the bounded window expires is treated as fresh → reloads again', async () => {
    mod.recoverFromStaleChunk(1000);
    const after = await reimportAsAfterReload();
    const action = after.recoverFromStaleChunk(1000 + mod.GUARD_WINDOW_MS + 1);
    expect(action).toBe('reload'); // window elapsed → fresh event
    expect(reloadSpy).toHaveBeenCalledTimes(2);
  });
});

describe('markStaleChunkBootSuccess (genuine boot clears the guard — NOT a frame heuristic)', () => {
  it('clears the persisted guard', () => {
    mod.recoverFromStaleChunk(1000);
    expect(window.sessionStorage.getItem(GUARD)).not.toBeNull();
    mod.markStaleChunkBootSuccess();
    expect(window.sessionStorage.getItem(GUARD)).toBeNull();
  });

  it('after a reload + GENUINE boot, a later failure inside the window is FRESH (reload), not escalated', async () => {
    mod.recoverFromStaleChunk(1000);                 // reload; guard count 1
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    // Reload lands on a WORKING deployment: a lazy route mounts → StaleChunkBootClear fires this.
    const after = await reimportAsAfterReload();
    after.markStaleChunkBootSuccess();               // genuine successful boot
    expect(window.sessionStorage.getItem(GUARD)).toBeNull();

    // A later, unrelated stale-chunk event (still inside the old window) must reload afresh, not show the UI.
    const action = after.recoverFromStaleChunk(1000 + 4_000);
    expect(action).toBe('reload');
    expect(reloadSpy).toHaveBeenCalledTimes(2);
    expect(document.getElementById('ss-stale-chunk-recovery')).toBeNull(); // not escalated
  });

  it('WITHOUT a genuine boot (chunk still 404s after reload), the guard is retained → escalation', async () => {
    mod.recoverFromStaleChunk(1000);
    const after = await reimportAsAfterReload();
    // No markStaleChunkBootSuccess() — the destination chunk failed again, so no lazy route ever mounted.
    const action = after.recoverFromStaleChunk(1000 + 4_000);
    expect(action).toBe('recover');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ss-stale-chunk-recovery')).not.toBeNull();
  });
});

describe('installStaleChunkRecovery', () => {
  it('a vite:preloadError → preventDefault + exactly one reload', () => {
    mod.installStaleChunkRecovery();
    const prevented = !window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(prevented).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('a non-chunk unhandledrejection is IGNORED (no reload, no guard claim)', () => {
    mod.installStaleChunkRecovery();
    window.dispatchEvent(Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason: new Error('unrelated') }));
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(GUARD)).toBeNull();
  });

  it('is IDEMPOTENT: repeated installs register exactly ONE listener per event type', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    mod.installStaleChunkRecovery();
    mod.installStaleChunkRecovery();
    mod.installStaleChunkRecovery();
    const count = (type: string) => addSpy.mock.calls.filter((c) => c[0] === type).length;
    expect(count('vite:preloadError')).toBe(1);
    expect(count('unhandledrejection')).toBe(1);
    expect(count('error')).toBe(1);
    addSpy.mockRestore();
  });
});
