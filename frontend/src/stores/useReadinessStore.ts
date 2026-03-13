import { create } from 'zustand';
import logger from '../lib/logger';

export interface ReadinessState {
  boot: boolean;
  layout: boolean;
  auth: boolean;
  analytics: boolean;
  stt: boolean;
  msw: boolean;
  timestamps: Record<string, number>;
}

interface ReadinessStore {
  signals: ReadinessState;
  setReady: (key: keyof Omit<ReadinessState, 'timestamps'>) => void;
  reset: () => void;
}

const INITIAL_STATE: ReadinessState = {
  boot: false,
  layout: false,
  auth: false,
  analytics: false,
  stt: false,
  msw: false,
  timestamps: {}
};

/**
 * UNIFIED READINESS STORE
 * ----------------------
 * Core architectural component to manage application boot signaling.
 * Enforces "Write-Once" and "No-Regression" rules for deterministic CI.
 */
export const useReadinessStore = create<ReadinessStore>((set, get) => ({
  signals: { ...INITIAL_STATE },

  setReady: (key) => {
    const current = get().signals;
    
    // 🛡️ Rule 1: No Regression (true -> false is forbidden)
    // 🛡️ Rule 2: Write-Once (ignore subsequent sets once true)
    if (current[key]) {
      logger.debug(`[ReadinessStore] Ignoring redundant signal: ${key}`);
      return;
    }

    const timestamp = performance.now();
    logger.info(`[ReadinessStore] ✅ Signal set: ${key} at ${Math.round(timestamp)}ms`);

    set((state) => {
      const newSignals = {
        ...state.signals,
        [key]: true,
        timestamps: {
          ...state.signals.timestamps,
          [key]: timestamp
        }
      };

      // 🚀 Sync to Global Window for Playwright visibility
      if (typeof window !== 'undefined') {
        window.__APP_READY_STATE__ = newSignals;
      }

      return { signals: newSignals };
    });
  },

  reset: () => {
    logger.info('[ReadinessStore] 🧪 Resetting readiness signals');
    set({ signals: { ...INITIAL_STATE, timestamps: { reset: performance.now() } } });
    
    if (typeof window !== 'undefined') {
      window.__APP_READY_STATE__ = get().signals;
    }
  }
}));

// Initialize window object immediately if it doesn't exist
if (typeof window !== 'undefined' && !window.__APP_READY_STATE__) {
  window.__APP_READY_STATE__ = useReadinessStore.getState().signals;
}
