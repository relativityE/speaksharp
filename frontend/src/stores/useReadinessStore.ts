import { create } from 'zustand';
import logger from '@/lib/logger';
import {
  READINESS_OPTIONAL_FEATURES,
  READINESS_REQUIRED_GLOBAL,
  type ReadinessSignal,
} from '@/e2e/signalContract';

interface AppReadyState {
  [key: string]: boolean | string | number | undefined | Record<string, number>;
  _timestamps?: Record<string, number>;
}

declare global {
  interface Window {
    __APP_READY_STATE__?: AppReadyState;
  }
}

export const REQUIRED_GLOBAL = READINESS_REQUIRED_GLOBAL;

export const checkGlobalReadiness = (signals: Record<string, boolean | Record<string, number>>) => {
  return REQUIRED_GLOBAL.every(k => !!signals[k]);
};

export const OPTIONAL_FEATURES = READINESS_OPTIONAL_FEATURES;
export type ReadinessAppState = 'BOOTING' | 'SERVICE_READY' | 'ENGINE_READY' | 'SUBSCRIBER_READY' | 'READY';

export type ReadinessSignals = Record<ReadinessSignal, boolean>;

export interface ReadinessStore {
  signals: ReadinessSignals;
  appState: ReadinessAppState;
  timestamps: Record<string, number>;
  setReady: (key: ReadinessSignal) => void;
  setAppState: (state: ReadinessAppState) => void;
  resetRouterReady: () => void;
  reset: () => void;
}

const INITIAL_SIGNALS: ReadinessSignals = {
  app: false,
  layout: false,
  auth: false,
  profile: false,
  analytics: false,
  stt: false,
  msw: false,
  router: false,
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
        const current: AppReadyState = window.__APP_READY_STATE__ || {};
        window.__APP_READY_STATE__ = {
          ...current,
          ...newSignals,
          _timestamps: {
            ...(current._timestamps || {}),
            ...newTimestamps
          }
        };
        if (key === 'profile') {
          document.documentElement.setAttribute('data-profile-ready', 'true');
        }
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
        const current: AppReadyState = window.__APP_READY_STATE__ || {};
        window.__APP_READY_STATE__ = {
          ...current,
          ...state.signals,
          _timestamps: {
            ...(current._timestamps || {}),
            ...newTimestamps
          }
        };
      }

      return {
        appState,
        timestamps: newTimestamps
      };
    });
  },


  resetRouterReady: () => {
    set((state) => {
      const newSignals = { ...state.signals, router: false };
      // We don't remove the timestamp, we just set the signal to false
      // to ensure the next "true" is picked up.
      return { signals: newSignals };
    });
    logger.info('[useReadinessStore] Router readiness reset (navigation initiated)');
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
      const current: AppReadyState = window.__APP_READY_STATE__ || {};
      window.__APP_READY_STATE__ = {
        ...current,
        ...INITIAL_SIGNALS,
        _timestamps: {
          ...(current._timestamps || {}),
          ...resetTimestamps
        }
      };
      document.documentElement.removeAttribute('data-profile-ready');
    }
  }
}));

// Initialize window object with PURE signals map + debug metadata
if (typeof window !== 'undefined' && (!window.__APP_READY_STATE__ || typeof window.__APP_READY_STATE__ === 'string')) {
  const state = useReadinessStore.getState();
  const current: AppReadyState = window.__APP_READY_STATE__ || {};
  window.__APP_READY_STATE__ = {
    ...current,
    ...state.signals,
    _timestamps: {
      ...(current._timestamps || {}),
      ...state.timestamps
    }
  };
}
