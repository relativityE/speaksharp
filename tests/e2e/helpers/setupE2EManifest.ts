import { Page } from '@playwright/test';
import type { ITranscriptionEngine } from '@/services/transcription/modes/types';

/**
 * setupE2EManifest — Atomic T=0 injection.
 *
 * Clears stale state and injects the deterministic E2E manifest
 * before the application boots. Accepts the same shape as window.__SS_E2E__.
 */
export async function setupE2EManifest(
  page: Page,
  config: {
    engineType?: 'mock' | 'real' | 'system';
    // Registry is now inlined in browser context (Serialization fix)
    flags?: { bypassMutex?: boolean; fastTimers?: boolean };
    debug?: boolean;
    storage?: Record<string, string>;
  }
) {
  const { storage = {}, ...manifest } = config;

  await page.addInitScript(({ m, s }: { m: unknown; s: Record<string, string> }) => {
    // 🛡️ T=0 Browser Context Extension
    interface E2EWindow extends Window {
      __SS_E2E__: {
        isActive: boolean;
        engineType?: 'mock' | 'real' | 'system';
        debug?: boolean;
        flags?: Record<string, unknown>;
        registry?: Record<string, unknown>;
        emitTranscript?: (text: string, isFinal?: boolean) => void;
      };
      __SS_E2E_ACTIVE_ENGINE__?: {
        emitTranscript: (text: string, isFinal: boolean) => void;
      };
    }

    const localManifest = m as E2EWindow['__SS_E2E__'];
    const localBrowserStorage = s;

    // 1. CLEAR: Strict Zero baseline — no stale state from previous runs
    window.localStorage.clear();

    // 2. STORAGE: Re-inject specific tokens (e.g. auth session)
    Object.entries(localBrowserStorage).forEach(([key, val]) => {
      window.localStorage.setItem(key, val);
    });

    // 3. REGISTRY: Define minimal stub factory literal INSIDE browser context
    const minimalStubFactory = () => {
      console.log('[E2E-MOCK] Factory creating minimal stub...');
      let activeCallbacks: Parameters<ITranscriptionEngine['init']>[0] | null = null;

      const instance = {
        instanceId: 'e2e-minimal-stub',
        init: async (callbacks: unknown) => {
          activeCallbacks = callbacks as Parameters<ITranscriptionEngine['init']>[0];
          (window as unknown as E2EWindow).__SS_E2E_ACTIVE_ENGINE__ = instance;
          if (localManifest.debug) console.log('[E2E-MOCK] Engine initialized.');
          return { isOk: true };
        },
        start: async () => { if (localManifest.debug) console.log('[E2E-MOCK] Engine started.'); },
        stop: async () => { if (localManifest.debug) console.log('[E2E-MOCK] Engine stopped.'); },
        getEngineType: () => 'mock',
        getLastHeartbeatTimestamp: () => Date.now(),
        // Modern Bridge: Trigger from inside the instance
        emitTranscript: (text: string, isFinal: boolean = true) => {
          if (activeCallbacks?.onTranscriptUpdate) {
            activeCallbacks.onTranscriptUpdate({
              transcript: isFinal ? { final: text } : { partial: text }
            });
          }
        }
      };

      return instance;
    };

    // 4. MANIFEST: Inject the E2E bridge before any module is imported (Defensive Merge)
    const win = window as unknown as E2EWindow;
    const existing = win.__SS_E2E__;

    win.__SS_E2E__ = {
      isActive: true,
      ...localManifest,
      flags: {
        bypassMutex: true,
        fastTimers: true,
        ...(localManifest.flags || {}),
        ...(existing?.flags || {})
      },
      registry: {
        mock: minimalStubFactory,
        'whisper-turbo': minimalStubFactory,
        'transformers-js': minimalStubFactory,
        'assemblyai': minimalStubFactory,
        'native-browser': minimalStubFactory,
        ...(existing?.registry || {})
      },
      // Central Bridge Modernization
      emitTranscript: (text: string, isFinal: boolean = true) => {
        if (localManifest.debug) console.log('[E2E-BRIDGE] Global Emit:', text);
        if (win.__SS_E2E_ACTIVE_ENGINE__?.emitTranscript) {
          win.__SS_E2E_ACTIVE_ENGINE__.emitTranscript(text, isFinal);
        } else {
          console.warn('[E2E-BRIDGE] No active engine to receive transcript:', text);
        }
      }
    };

    if (localManifest.debug) console.log('[T=0] Hardened Manifest injected, engineType:', localManifest.engineType);
  }, { m: manifest, s: storage });
}
