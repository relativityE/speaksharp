/**
 * Centralized Test IDs
 * 
 * Single source of truth for all data-testid attributes in the application.
 * Imported by components and tests to ensure selector consistency.
 */

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
    SESSION_HISTORY_ITEM: 'session-history-item', // Base for dynamic IDs: session-history-item-${id}
    COMPARE_CHECKBOX: 'compare-checkbox',
    STAT_CARD_TOTAL_SESSIONS: 'stat-card-total_sessions',

    // Landing page
    HERO_SECTION: 'hero-section',
    LANDING_FOOTER: 'landing-footer',

    // Loading states
    PROTECTED_ROUTE_LOADING: 'protected-route-loading',
} as const;

export type TestIdKey = keyof typeof TEST_IDS;
export type TestIdValue = typeof TEST_IDS[TestIdKey];
