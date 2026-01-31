// tests/constants.ts
/**
 * Centralized Test Constants
 * 
 * Single source of truth for all routes, selectors, testids, and credentials.
 * DO NOT hardcode these values in test files - import from here.
 */

// ============================================
// TEST USER CREDENTIALS
// ============================================

export const TEST_USER_PRO = {
  email: 'pro-user@test.com',
  password: 'password123',
};

export const TEST_USER_FREE = {
  email: 'free-user@test.com',
  password: 'password123',
};

export const TEST_USER_EMAIL = 'test-user@example.com';
export const TEST_USER_PASSWORD = 'password123';

export const SOAK_TEST_USER = {
  email: 'soak-test0@test.com',
  password: process.env.SOAK_TEST_PASSWORD || 'speaksharp1',
};

// Canary test user for production smoke tests
// Password is shared via CANARY_PASSWORD secret in GitHub Actions
export const CANARY_USER = {
  email: 'canary-user@speaksharp.app',
  password: process.env.CANARY_PASSWORD || '',
};

// Array of soak test users for concurrent testing
// Emails follow pattern: soak-test{N}@test.com (0-indexed)
// Password is shared via SOAK_TEST_PASSWORD env var
// Can be overridden via NEW_FREE_COUNT and NEW_PRO_COUNT env vars in CI
const getEnvNum = (key: string, def: number) => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    const val = parseInt(process.env[key] as string, 10);
    return isNaN(val) || val <= 0 ? def : val;
  }
  return def;
};

export const FREE_USER_COUNT = getEnvNum('NEW_FREE_COUNT', 7);
export const PRO_USER_COUNT = getEnvNum('NEW_PRO_COUNT', 3);
export const CONCURRENT_USER_COUNT = FREE_USER_COUNT + PRO_USER_COUNT; // 10 total by default
export const MAX_TOTAL_TEST_USERS = 100; // Safety cap to prevent provisioning overload

// Auto-generate tiers: first FREE_USER_COUNT are free, next PRO_USER_COUNT are pro
// Example: 2 free + 1 pro = ['free', 'free', 'pro']
export const SOAK_USER_TIERS: ('free' | 'pro')[] = [
  ...Array(FREE_USER_COUNT).fill('free' as const),
  ...Array(PRO_USER_COUNT).fill('pro' as const),
];

export const SOAK_TEST_USERS = Array.from(
  { length: CONCURRENT_USER_COUNT },
  (_, i) => ({
    email: `soak-test${i}@test.com`,
    password: process.env.SOAK_TEST_PASSWORD || `speaksharp${i + 1}`,
    tier: SOAK_USER_TIERS[i],
  })
);

// ============================================
// ROUTES
// ============================================

export const ROUTES = {
  // Public routes (no auth required)
  HOME: '/',
  SIGN_IN: '/auth/signin',
  SIGN_UP: '/auth/signup',
  AUTH: '/auth',

  // Protected routes (auth required)
  SESSION: '/session',
  ANALYTICS: '/analytics',
  analyticsWithSession: (sessionId: string) => `/analytics/${sessionId}`,
} as const;

// ============================================
// TEST IDS (Centralized Mirror)
// ============================================

// NOTE: We mirror the values here because directly importing from src/ in tests
// can sometimes cause TS/Vite issues depending on the runner configuration.
// ideally we would import { TEST_IDS as APP_TEST_IDS } from '../frontend/src/constants/testIds';
// but for robustness we will define them here matching the source.

export const TEST_IDS = {
  // App-level
  APP_MAIN: 'app-main',

  // Navigation
  NAV_SIGN_OUT_BUTTON: 'nav-sign-out-button',
  NAV_HOME_LINK: 'nav-home-link',
  NAV_SESSION_LINK: 'nav-session-link',
  NAV_ANALYTICS_LINK: 'nav-analytics-link',
  NAV_SIGN_IN_LINK: 'nav-sign-in-link',
  SESSION_SETTINGS_BUTTON: 'add-custom-word-button', // Filler words popover trigger button

  // Auth forms
  AUTH_FORM: 'auth-form',
  EMAIL_INPUT: 'email-input',
  PASSWORD_INPUT: 'password-input',
  SIGN_IN_SUBMIT: 'sign-in-submit',
  SIGN_IN_BUTTON: 'sign-in-button',

  // Session page
  SESSION_SIDEBAR: 'session-sidebar',
  SESSION_START_STOP_BUTTON: 'session-start-stop-button',
  SESSION_STATUS_INDICATOR: 'session-status-indicator',
  TRANSCRIPT_PANEL: 'transcript-panel',
  TRANSCRIPT_CONTAINER: 'transcript-container',
  TRANSCRIPT_DISPLAY: 'transcript-display',
  MODEL_LOADING_INDICATOR: 'model-loading-indicator',

  // Metrics
  CLARITY_SCORE_VALUE: 'clarity-score-value',
  WPM_VALUE: 'wpm-value',
  FILLER_COUNT_VALUE: 'filler-count-value',
  STAT_CARD_SPEAKING_PACE: 'stat-card-speaking_pace',

  // Analytics page
  ANALYTICS_DASHBOARD: 'analytics-dashboard',
  ANALYTICS_SKELETON: 'analytics-dashboard-skeleton',
  ANALYTICS_EMPTY_STATE: 'analytics-dashboard-empty-state',
  ANALYTICS_UPGRADE_BUTTON: 'analytics-dashboard-upgrade-button',
  SESSION_HISTORY_LIST: 'session-history-list',
  SESSION_HISTORY_ITEM: 'session-history-item',
  COMPARE_CHECKBOX: 'compare-checkbox',
  STAT_CARD_TOTAL_SESSIONS: 'stat-card-total_sessions',
  PRO_BADGE: 'pro-badge',

  // Landing page
  HERO_SECTION: 'hero-section',
  LANDING_FOOTER: 'landing-footer',

  // Session Settings / Mode Select
  STT_MODE_SELECT: 'stt-mode-select',
  STT_MODE_NATIVE: 'stt-mode-native',
  STT_MODE_CLOUD: 'stt-mode-cloud',

  // Loading states
  PROTECTED_ROUTE_LOADING: 'protected-route-loading',
} as const;

// ... (Timeouts and Soak Config remain unchanged)

// ============================================
// TIMEOUTS (milliseconds)
// ============================================

export const TIMEOUTS = {
  SHORT: 5000,
  MEDIUM: 10000,
  LONG: 15000,
  AUTH: 15000,
  PAGE_LOAD: 30000,
} as const;

// ============================================
// SOAK TEST CONFIG
// ============================================

export const SOAK_CONFIG = {
  CONCURRENT_USERS: CONCURRENT_USER_COUNT,
  SESSION_DURATION_MS: 5 * 60 * 1000, // 5 minutes per session
  PLAYWRIGHT_TIMEOUT_MS: 10 * 60 * 1000, // 10 minute Playwright test timeout
  P95_THRESHOLD_MS: 10000, // Max acceptable P95 response time (Increased for CI variance)
  MAX_MEMORY_MB: 200, // Max acceptable memory per tab
  USE_NATIVE_MODE: true,
  TRACK_MEMORY: true,
  RESULTS_DIR: 'test-results/soak',
} as const;
