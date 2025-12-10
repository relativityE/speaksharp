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
  email: 'soak-test@test.com',
  password: 'speaksharp1',
};

// Array of soak test users for concurrent testing (each user gets different credentials)
export const SOAK_TEST_USERS = [
  { email: 'soak-test@test.com', password: 'speaksharp1' },
  { email: 'soak-test1@test.com', password: 'speaksharp2' },
] as const;

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
  SESSION_SETTINGS_BUTTON: 'session-settings-button',

  // Auth forms
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
  SESSION_HISTORY_LIST: 'session-history-list',
  SESSION_HISTORY_ITEM: 'session-history-item',
  COMPARE_CHECKBOX: 'compare-checkbox',
  STAT_CARD_TOTAL_SESSIONS: 'stat-card-total_sessions',

  // Landing page
  HERO_SECTION: 'hero-section',
  LANDING_FOOTER: 'landing-footer',

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
  CONCURRENT_USERS: 2,
  SESSION_DURATION_MS: 5 * 60 * 1000, // 5 minutes
  USE_NATIVE_MODE: true,
  TRACK_MEMORY: true,
  RESULTS_DIR: 'test-results/soak',
} as const;

