import { create } from 'zustand';
import logger from '../lib/logger';

export const REQUIRED_GLOBAL = ['boot', 'layout', 'auth', 'stt', 'msw'] as const;

export const checkGlobalReadiness = (signals: Record<string, boolean | Record<string, number>>) => {
  return REQUIRED_GLOBAL.every(k => !!signals[k]);
};

export const OPTIONAL_FEATURES = ['analytics', 'profile', 'route'] as const;

export type ReadinessSignal = (typeof REQUIRED_GLOBAL)[number] | (typeof OPTIONAL_FEATURES)[number];
export type ReadinessAppState = 'BOOTING' | 'SERVICE_READY' | 'ENGINE_READY' | 'SUBSCRIBER_READY' | 'READY';

export type ReadinessSignals = Record<ReadinessSignal, boolean>;

export interface ReadinessStore {
  signals: ReadinessSignals;
  appState: ReadinessAppState;
  timestamps: Record<string, number>;
  setReady: (key: ReadinessSignal) => void;
  setAppState: (state: ReadinessAppState) => void;
  resetRouteReady: () => void;
  reset: () => void;
}

const INITIAL_SIGNALS: ReadinessSignals = {
  boot: false,
  layout: false,
  auth: false,
  profile: false,
  analytics: false,
  stt: false,
  msw: false,
  route: false,
};


/**
 * UNIFIED READINESS STORE
 * ----------------------
 * Core architectural component to manage application boot signaling.
 * Enforces "Write-Once" and "No-Regression" rules for deterministic CI.
 */
export const useReadinessStore = create<ReadinessStore>((set, get) => ({
  signals: { ...INITIAL_SIGNALS },
  appState: 'BOOTING',
  timestamps: {},

  setReady: (key) => {
    set((state) => {
      const newSignals = {
        ...state.signals,
        [key]: true,
      };
      const newTimestamps = {
        ...state.timestamps,
        [key]: performance.now()
      };

      // Synchronize PURE signal map + traceability to window
      if (typeof window !== 'undefined') {
        window.__APP_READY_STATE__ = {
          ...newSignals,
          _timestamps: newTimestamps
        };
      }

      return {
        signals: newSignals,
        timestamps: newTimestamps
      };
    });

    logger.info(`[useReadinessStore] Signal set: ${key}`);
  },

  setAppState: (appState) => {
    const current = get().appState;
    if (current === appState) return;

    logger.info(`[ReadinessStore] App State Transition: ${current} -> ${appState}`);

    set((state) => {
      const newTimestamps = {
        ...state.timestamps,
        [`appState_${appState}`]: performance.now()
      };

      if (typeof window !== 'undefined') {
        window.__APP_READY_STATE__ = {
          ...state.signals,
          _timestamps: newTimestamps
        };
      }

      return {
        appState,
        timestamps: newTimestamps
      };
    });
  },

  resetRouteReady: () => {
    set((state) => {
      const newSignals = { ...state.signals, route: false };
      // We don't remove the timestamp, we just set the signal to false
      // to ensure the next "true" is picked up.
      return { signals: newSignals };
    });
    logger.info('[useReadinessStore] Route readiness reset (navigation initiated)');
  },

  reset: () => {
    logger.info('[ReadinessStore] Resetting readiness signals');
    const resetTimestamps = { reset: performance.now() };
    set({
      signals: { ...INITIAL_SIGNALS },
      appState: 'BOOTING',
      timestamps: resetTimestamps
    });

    if (typeof window !== 'undefined') {
      window.__APP_READY_STATE__ = {
        ...INITIAL_SIGNALS,
        _timestamps: resetTimestamps
      };
    }
  }
}));

// Initialize window object with PURE signals map + debug metadata
if (typeof window !== 'undefined' && (!window.__APP_READY_STATE__ || typeof window.__APP_READY_STATE__ === 'string')) {
  const state = useReadinessStore.getState();
  window.__APP_READY_STATE__ = {
    ...state.signals,
    _timestamps: state.timestamps
  };
}
