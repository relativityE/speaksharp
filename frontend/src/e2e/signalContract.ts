/**
 * Canonical E2E, readiness, and forensic signal contract.
 *
 * Taxonomy:
 * - Flag = tell the app what to do.
 * - Signal = app tells us what happened.
 * - testId = find this element.
 * - UI state attr = component state/styling.
 *
 * Signals are observable app outputs. They must not change behavior.
 * Flags are inputs/test knobs. They may change behavior.
 * Selectors identify UI elements. They are not readiness proof.
 *
 * Status terms:
 * - active: current supported contract.
 * - legacy: still used somewhere, but no new usage should be added.
 * - deprecated: obsolete or conflicting, with a replacement.
 *
 * Group terms:
 * - TEST_FLAGS change app behavior.
 * - DEBUG_TRACES observe or record behavior.
 * - LEGACY_SIGNALS are compatibility inventory, not approved new usage.
 * - DEPRECATED_SIGNALS are removal candidates once callers are gone.
 *
 * data-testid values are intentionally not listed here. See
 * frontend/src/constants/testIds.ts for stable element selectors.
 */

export const READINESS_REQUIRED_GLOBAL = ['app', 'layout', 'auth', 'stt', 'msw'] as const;

export const READINESS_OPTIONAL_FEATURES = ['analytics', 'profile', 'router'] as const;

export type ReadinessSignal =
  | (typeof READINESS_REQUIRED_GLOBAL)[number]
  | (typeof READINESS_OPTIONAL_FEATURES)[number];

export type ContractKind =
  | 'readiness-key'
  | 'dom-signal'
  | 'window-signal'
  | 'test-flag'
  | 'debug-trace'
  | 'ui-selector'
  | 'artifact-marker';

export type ContractStatus = 'active' | 'legacy' | 'deprecated';
export type ContractAudience = 'app-runtime' | 'e2e' | 'manual-proof' | 'diagnostic' | 'unit-test';

export interface SignalContractEntry {
  name: string;
  kind: ContractKind;
  status: ContractStatus;
  audience: readonly ContractAudience[];
  owner: string;
  writers: readonly string[];
  readers: readonly string[];
  intent: string;
  waitGuidance: string;
  replacement: string | null;
}

export const SIGNAL_CONTRACT = [
  {
    name: 'app',
    kind: 'readiness-key',
    status: 'active',
    audience: ['app-runtime', 'e2e', 'diagnostic'],
    owner: 'frontend/src/stores/useReadinessStore.ts',
    writers: ['frontend/src/main.tsx'],
    readers: ['frontend/src/stores/useReadinessStore.ts', 'tests/e2e/helpers.ts'],
    intent: 'Structured readiness key for app boot in __APP_READY_STATE__.',
    waitGuidance: 'Use as a subsystem readiness key only. Prefer data-app-ready for DOM boot waits.',
    replacement: null,
  },
  {
    name: 'layout',
    kind: 'readiness-key',
    status: 'active',
    audience: ['app-runtime', 'e2e', 'diagnostic'],
    owner: 'frontend/src/stores/useReadinessStore.ts',
    writers: ['frontend/src/App.tsx'],
    readers: ['frontend/src/stores/useReadinessStore.ts', 'tests/e2e/helpers.ts'],
    intent: 'Structured readiness key for app layout shell.',
    waitGuidance: 'Use in composite subsystem readiness, not as route-specific UI proof.',
    replacement: null,
  },
  {
    name: 'auth',
    kind: 'readiness-key',
    status: 'active',
    audience: ['app-runtime', 'e2e', 'diagnostic'],
    owner: 'frontend/src/stores/useReadinessStore.ts',
    writers: ['frontend/src/contexts/AuthProvider.tsx'],
    readers: ['frontend/src/stores/useReadinessStore.ts', 'tests/e2e/helpers.ts'],
    intent: 'Structured readiness key for auth/session hydration.',
    waitGuidance: 'Use before auth-dependent checks; still prefer visible route controls before clicks.',
    replacement: null,
  },
  {
    name: 'stt',
    kind: 'readiness-key',
    status: 'active',
    audience: ['app-runtime', 'e2e', 'diagnostic'],
    owner: 'frontend/src/stores/useReadinessStore.ts',
    writers: ['frontend/src/services/SpeechRuntimeController.ts'],
    readers: ['frontend/src/stores/useReadinessStore.ts', 'tests/e2e/helpers.ts'],
    intent: 'Structured readiness key for STT infrastructure.',
    waitGuidance: 'Use for subsystem diagnostics. Use data-runtime-state/visible controls for recording readiness.',
    replacement: null,
  },
  {
    name: 'msw',
    kind: 'readiness-key',
    status: 'active',
    audience: ['e2e', 'diagnostic'],
    owner: 'frontend/src/stores/useReadinessStore.ts',
    writers: ['frontend/src/main.tsx', 'frontend/src/lib/e2e-bridge.ts'],
    readers: ['frontend/src/stores/useReadinessStore.ts', 'tests/e2e/helpers.ts'],
    intent: 'Structured readiness key for E2E mock/network layer.',
    waitGuidance: 'Use instead of mswReady for new mock-layer waits.',
    replacement: null,
  },
  {
    name: 'analytics',
    kind: 'readiness-key',
    status: 'active',
    audience: ['app-runtime', 'e2e'],
    owner: 'frontend/src/stores/useReadinessStore.ts',
    writers: ['frontend/src/pages/AnalyticsPage.tsx', 'frontend/src/hooks/useAnalytics.ts'],
    readers: ['tests/e2e/helpers.ts'],
    intent: 'Optional feature readiness key for analytics data.',
    waitGuidance: 'Use with visible analytics dashboard controls before assertions.',
    replacement: null,
  },
  {
    name: 'profile',
    kind: 'readiness-key',
    status: 'active',
    audience: ['app-runtime', 'e2e'],
    owner: 'frontend/src/stores/useReadinessStore.ts',
    writers: ['frontend/src/components/ProfileGuard.tsx', 'frontend/src/stores/useReadinessStore.ts'],
    readers: ['tests/e2e/helpers.ts'],
    intent: 'Optional feature readiness key for user profile/tier hydration.',
    waitGuidance: 'Use for profile hydration, not route paint.',
    replacement: null,
  },
  {
    name: 'router',
    kind: 'readiness-key',
    status: 'active',
    audience: ['app-runtime', 'e2e'],
    owner: 'frontend/src/stores/useReadinessStore.ts',
    writers: ['frontend/src/App.tsx'],
    readers: ['tests/e2e/helpers.ts'],
    intent: 'Optional readiness key for router/navigation progress.',
    waitGuidance: 'Do not treat as route UI proof; follow with waitForRouteControls().',
    replacement: null,
  },
  {
    name: 'data-app-ready',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'manual-proof', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts and frontend/src/main.tsx',
    writers: ['setAppReady()', 'frontend/src/main.tsx boot mount'],
    readers: ['tests/e2e/helpers.ts waitForAppReadySignal()', 'manual/live proof scripts'],
    intent: 'Boot-shell barrier. Indicates the app shell has mounted and can be inspected.',
    waitGuidance: 'Safe as a first boot wait only. Do not use as proof that a specific route UI is painted.',
    replacement: null,
  },
  {
    name: 'data-runtime-state',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'manual-proof', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['syncForensicAnchors()'],
    readers: ['tests/e2e/infra.probe.e2e.spec.ts', 'tests/e2e/primary-journey.e2e.spec.ts', 'manual/live proof scripts'],
    intent: 'Current speech runtime/FSM state for start/stop lifecycle assertions.',
    waitGuidance: 'Use for engine lifecycle gates such as READY, RECORDING, STOPPING, and failure diagnostics.',
    replacement: null,
  },
  {
    name: 'data-stt-ready',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'manual-proof', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['syncSTTReady()'],
    readers: ['tests/e2e/helpers.ts', 'manual/live proof scripts'],
    intent: 'Boolean STT readiness mirror used by model/private/native proof tooling.',
    waitGuidance: 'Use as a fallback readiness clue; route tests should prefer visible controls before clicking.',
    replacement: null,
  },
  {
    name: 'data-engine-ready',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['syncEngineReady()'],
    readers: ['engine lifecycle diagnostics'],
    intent: 'Engine-specific readiness signal, 1:1 with controller state.',
    waitGuidance: 'Use for engine contract tests, not for route navigation readiness.',
    replacement: null,
  },
  {
    name: 'data-stt-mode',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['syncSTTIdentity()'],
    readers: ['tests/e2e/infra.probe.e2e.spec.ts'],
    intent: 'Negotiated STT mode identity exposed for E2E identity assertions.',
    waitGuidance: 'Use to assert native/cloud/private identity after negotiation.',
    replacement: null,
  },
  {
    name: 'data-stt-is-mock',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['syncSTTIdentity()', 'syncNegotiatorDecision()'],
    readers: ['tests/e2e/infra.probe.e2e.spec.ts'],
    intent: 'Indicates whether the active STT engine is an injected mock.',
    waitGuidance: 'Use in infra probes to prevent accidental real-engine execution in mocked E2E.',
    replacement: null,
  },
  {
    name: 'data-stt-resolved-mode',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['syncNegotiatorDecision()'],
    readers: ['policy/negotiation diagnostics'],
    intent: 'Latest resolved transcription mode from STT negotiation.',
    waitGuidance: 'Use for policy resolution assertions; prefer control test IDs for UI interactions.',
    replacement: null,
  },
  {
    name: 'data-stt-policy',
    kind: 'dom-signal',
    status: 'active',
    audience: ['diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['syncForensicAnchors()'],
    readers: ['tests/canary/smoke.canary.spec.ts'],
    intent: 'Optional body-level trace of active transcription policy/mode.',
    waitGuidance: 'Diagnostic only. Do not gate tests on it unless asserting policy propagation.',
    replacement: null,
  },
  {
    name: 'data-session-persisted',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'manual-proof', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['syncSessionPersisted()'],
    readers: ['tests/e2e/primary-journey.e2e.spec.ts', 'tests/e2e/user-facing-regressions.e2e.spec.ts', 'manual/live proof scripts'],
    intent: 'Session save/finalization completed successfully.',
    waitGuidance: 'Use after stop to prove persistence before navigating to analytics/history.',
    replacement: null,
  },
  {
    name: 'data-profile-ready',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts and frontend/src/stores/useReadinessStore.ts',
    writers: ['syncProfileReady()', 'useReadinessStore.setReady("profile")'],
    readers: ['tests/e2e/helpers.ts waitForProfileReady()'],
    intent: 'User profile and tier are hydrated.',
    waitGuidance: 'Use after auth setup; does not prove a route page has painted.',
    replacement: null,
  },
  {
    name: 'data-error-visible',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['syncForensicAnchors()'],
    readers: ['negative/error-state diagnostics'],
    intent: 'Explicit user-visible runtime error state.',
    waitGuidance: 'Use for negative/error-state tests.',
    replacement: null,
  },
  {
    name: 'data-recording',
    kind: 'dom-signal',
    status: 'active',
    audience: ['e2e', 'manual-proof'],
    owner: 'session UI components',
    writers: ['frontend/src/components/session/LiveRecordingCard.tsx', 'frontend/src/components/session/StatusNotificationBar.tsx'],
    readers: ['E2E journey specs', 'manual/live proof scripts'],
    intent: 'Per-control recording state for user-facing start/stop assertions.',
    waitGuidance: 'Prefer this on the start/stop button for UI behavior assertions.',
    replacement: null,
  },
  {
    name: 'data-model-status',
    kind: 'dom-signal',
    status: 'legacy',
    audience: ['e2e', 'manual-proof'],
    owner: 'frontend/src/services/transcription/TranscriptionService.ts',
    writers: ['TranscriptionService state listener'],
    readers: ['legacy manual/live Private STT proof scripts'],
    intent: 'Older model download/readiness status.',
    waitGuidance: 'Avoid new tests. Prefer data-stt-ready, data-runtime-state, or visible download/ready UI.',
    replacement: 'data-stt-ready / data-runtime-state / visible download UI',
  },
  {
    name: 'data-user-tier',
    kind: 'dom-signal',
    status: 'legacy',
    audience: ['diagnostic'],
    owner: 'frontend/src/hooks/useSessionLifecycle.ts',
    writers: ['useSessionLifecycle dev/test diagnostic path'],
    readers: ['No active waiters found in grep; retained as legacy inventory.'],
    intent: 'Older tier exposure signal.',
    waitGuidance: 'Avoid for production assertions. Prefer visible tier UI or profile-ready plus explicit mock state.',
    replacement: 'data-profile-ready plus visible tier UI',
  },
  {
    name: '__APP_READY_STATE__',
    kind: 'window-signal',
    status: 'active',
    audience: ['e2e', 'diagnostic'],
    owner: 'frontend/src/stores/useReadinessStore.ts',
    writers: ['useReadinessStore.setReady()', 'useReadinessStore.reset()', 'tests/e2e/helpers/setupE2EManifest.ts'],
    readers: ['tests/e2e/helpers.ts waitForFeature()', 'tests/e2e/helpers.ts waitForAppAndFeatures()'],
    intent: 'Structured map of subsystem readiness signals plus timestamps.',
    waitGuidance: 'Good for subsystem diagnostics. Do not treat it as proof that specific route controls are visible.',
    replacement: null,
  },
  {
    name: '__SS_MASTER_CONTROL__',
    kind: 'window-signal',
    status: 'active',
    audience: ['diagnostic'],
    owner: 'frontend/src/lib/forensicAnchors.ts',
    writers: ['forensicAnchors module initialization and sync helpers'],
    readers: ['diagnostic tooling'],
    intent: 'Central diagnostic mirror for FSM, auth, engine, and ad-hoc forensic signals.',
    waitGuidance: 'Diagnostic only. Prefer DOM attributes or visible controls for tests.',
    replacement: null,
  },
  {
    name: '__APP_BOOTED__',
    kind: 'window-signal',
    status: 'legacy',
    audience: ['diagnostic'],
    owner: 'frontend/src/main.tsx',
    writers: ['frontend/src/main.tsx'],
    readers: ['tests/e2e/diagnostics/startup-diagnostic.spec.ts'],
    intent: 'Older boot diagnostic boolean.',
    waitGuidance: 'Avoid new waits. Prefer data-app-ready for boot-shell readiness.',
    replacement: 'data-app-ready',
  },
  {
    name: 'mswReady',
    kind: 'window-signal',
    status: 'legacy',
    audience: ['e2e', 'diagnostic'],
    owner: 'frontend/src/lib/e2e-bridge.ts and frontend/src/main.tsx',
    writers: ['initializeE2EEnvironment()', 'main.tsx test boot path'],
    readers: ['legacy E2E types/support code'],
    intent: 'Older MSW readiness boolean.',
    waitGuidance: 'Avoid new waits. Prefer __APP_READY_STATE__.msw when a mock-layer signal is needed.',
    replacement: '__APP_READY_STATE__.msw',
  },
  {
    name: '__SS_E2E__',
    kind: 'test-flag',
    status: 'active',
    audience: ['e2e', 'unit-test'],
    owner: 'tests/e2e/helpers/setupE2EManifest.ts and frontend/src/config/TestFlags.ts',
    writers: ['tests/e2e/helpers/setupE2EManifest.ts', 'tests/types/e2eConfig.ts'],
    readers: ['frontend/src/config/TestFlags.ts', 'frontend/src/App.tsx', 'frontend/src/services/transcription/*'],
    intent: 'Primary E2E manifest and dependency injection bridge.',
    waitGuidance: 'Do not wait on this for UI readiness; it is a behavior-changing test flag.',
    replacement: null,
  },
  {
    name: '__E2E_CONTEXT__',
    kind: 'test-flag',
    status: 'active',
    audience: ['e2e', 'manual-proof'],
    owner: 'E2E/live proof setup',
    writers: ['tests/live/*', 'frontend/src/lib/e2e-bridge.ts'],
    readers: ['frontend/src/lib/e2e-bridge.ts', 'frontend/src/services/transcription/modes/NativeBrowser.ts'],
    intent: 'Marks browser context as E2E/proof controlled.',
    waitGuidance: 'Not a readiness signal.',
    replacement: null,
  },
  {
    name: '__E2E_EMPTY_SESSIONS__',
    kind: 'test-flag',
    status: 'active',
    audience: ['e2e'],
    owner: 'E2E mock data setup',
    writers: ['tests/e2e/mock-routes.ts', 'tests/types/e2eConfig.ts'],
    readers: ['frontend/src/lib/mockSupabase.ts', 'frontend/src/mocks/handlers.ts'],
    intent: 'Forces empty session history in mocked E2E.',
    waitGuidance: 'Not a readiness signal.',
    replacement: null,
  },
  {
    name: '__E2E_MOCK_SESSION__',
    kind: 'test-flag',
    status: 'active',
    audience: ['e2e'],
    owner: 'E2E bridge',
    writers: ['tests/e2e/error-states.e2e.spec.ts', 'tests/e2e/types.d.ts'],
    readers: ['frontend/src/lib/e2e-bridge.ts', 'frontend/src/services/transcription/modes/PrivateWhisper.ts'],
    intent: 'Forces mock session creation behavior.',
    waitGuidance: 'Not a readiness signal.',
    replacement: null,
  },
  {
    name: '__FORCE_TRANSFORMERS_JS__',
    kind: 'test-flag',
    status: 'active',
    audience: ['manual-proof'],
    owner: 'Private STT live proof setup',
    writers: ['tests/live/*'],
    readers: ['Private STT engine selection path'],
    intent: 'Forces Transformers.js private STT path in proof runs.',
    waitGuidance: 'Not a readiness signal.',
    replacement: null,
  },
  {
    name: '__STT_LOAD_TIMEOUT__',
    kind: 'test-flag',
    status: 'active',
    audience: ['manual-proof'],
    owner: 'Private STT live proof setup',
    writers: ['tests/live/*'],
    readers: ['Private STT load path'],
    intent: 'Overrides STT load timeout for slow model proof runs.',
    waitGuidance: 'Not a readiness signal.',
    replacement: null,
  },
  {
    name: '__NATIVE_STT_DIAGNOSTIC_CONFIG__',
    kind: 'test-flag',
    status: 'active',
    audience: ['manual-proof', 'diagnostic'],
    owner: 'frontend/src/services/transcription/modes/nativeBrowserStrategies.ts',
    writers: ['Native diagnostic tests/proofs'],
    readers: ['resolveNativeBrowserStrategy()'],
    intent: 'Overrides Native Browser STT strategy settings for A/B diagnostics.',
    waitGuidance: 'Not a readiness signal. Never use as production support proof by itself.',
    replacement: null,
  },
  {
    name: '__NATIVE_BROWSER_TRACE__',
    kind: 'debug-trace',
    status: 'active',
    audience: ['manual-proof', 'diagnostic'],
    owner: 'frontend/src/services/transcription/modes/NativeBrowser.ts',
    writers: ['NativeBrowser trace helpers'],
    readers: ['manual native proof scripts'],
    intent: 'Captures Native Web Speech lifecycle events for browser diagnostics.',
    waitGuidance: 'Diagnostic only.',
    replacement: null,
  },
  {
    name: '__PRIVATE_TRANSCRIPT_TRACE__',
    kind: 'debug-trace',
    status: 'active',
    audience: ['manual-proof', 'diagnostic'],
    owner: 'Private STT engines and TranscriptionService',
    writers: ['TransformersJSEngine', 'TransformersJSV4Engine', 'TranscriptionService'],
    readers: ['manual Private STT proof scripts'],
    intent: 'Captures Private STT transcript/finalization diagnostics.',
    waitGuidance: 'Diagnostic only.',
    replacement: null,
  },
  {
    name: '__PRIVATE_STT_TIMELINE__',
    kind: 'debug-trace',
    status: 'active',
    audience: ['manual-proof', 'diagnostic'],
    owner: 'frontend/src/services/transcription/modes/PrivateWhisper.ts',
    writers: ['PrivateWhisper'],
    readers: ['manual Private STT proof scripts'],
    intent: 'Captures Private STT lifecycle timeline.',
    waitGuidance: 'Diagnostic only.',
    replacement: null,
  },
  {
    name: '__NATIVE_PARALLEL_CAPTURE__',
    kind: 'debug-trace',
    status: 'active',
    audience: ['manual-proof', 'diagnostic'],
    owner: 'frontend/src/services/transcription/modes/NativeBrowser.ts',
    writers: ['NativeBrowser parallel capture path'],
    readers: ['manual native proof scripts'],
    intent: 'Stores optional Native mic capture evidence for diagnostics.',
    waitGuidance: 'Diagnostic only; keep disabled outside proof runs.',
    replacement: null,
  },
  {
    name: 'boot',
    kind: 'readiness-key',
    status: 'deprecated',
    audience: ['e2e'],
    owner: 'legacy E2E helpers',
    writers: ['tests/e2e/helpers/setupE2EManifest.ts before contract cleanup'],
    readers: ['tests/e2e/helpers.ts before contract cleanup'],
    intent: 'Old boot readiness key that conflicts with active app readiness key.',
    waitGuidance: 'Do not use.',
    replacement: 'app',
  },
  {
    name: 'CORE_READINESS_SIGNALS',
    kind: 'readiness-key',
    status: 'deprecated',
    audience: ['diagnostic'],
    owner: 'frontend/src/config/readiness.ts',
    writers: ['frontend/src/config/readiness.ts'],
    readers: ['No active imports found in grep.'],
    intent: 'Old canonical readiness declaration that does not match the active readiness store.',
    waitGuidance: 'Do not use.',
    replacement: 'READINESS_REQUIRED_GLOBAL',
  },
  {
    name: '__APP_READY__',
    kind: 'window-signal',
    status: 'deprecated',
    audience: ['diagnostic'],
    owner: 'legacy E2E globals',
    writers: ['No active writer found in grep.'],
    readers: ['frontend/src/types/global.d.ts declaration only'],
    intent: 'Older global app-ready boolean.',
    waitGuidance: 'Do not use.',
    replacement: 'data-app-ready',
  },
  {
    name: 'data-user-ready',
    kind: 'dom-signal',
    status: 'deprecated',
    audience: ['diagnostic'],
    owner: 'legacy E2E contract',
    writers: ['No active writer found in grep.'],
    readers: ['No active reader found in grep.'],
    intent: 'Older user hydration signal.',
    waitGuidance: 'Do not use.',
    replacement: 'data-profile-ready',
  },
  {
    name: 'data-nlp-ready',
    kind: 'dom-signal',
    status: 'deprecated',
    audience: ['diagnostic'],
    owner: 'legacy analytics/NLP readiness contract',
    writers: ['No active writer found in grep.'],
    readers: ['No active reader found in grep.'],
    intent: 'Older NLP readiness signal.',
    waitGuidance: 'Do not use.',
    replacement: 'analytics readiness key plus visible analytics UI',
  },
] as const satisfies readonly SignalContractEntry[];

/** DOM_SIGNALS are observable DOM outputs from the app. They must not change app behavior. */
export const DOM_SIGNALS = SIGNAL_CONTRACT.filter(entry => entry.kind === 'dom-signal');

/** WINDOW_SIGNALS are observable window/global outputs from the app. They must not change app behavior. */
export const WINDOW_SIGNALS = SIGNAL_CONTRACT.filter(entry => entry.kind === 'window-signal');

/** TEST_FLAGS are inputs/test knobs that can change app behavior. They are not readiness proof. */
export const TEST_FLAGS = SIGNAL_CONTRACT.filter(entry => entry.kind === 'test-flag');

/** DEBUG_TRACES observe or record behavior for diagnostics/proofs. They should not control app behavior. */
export const DEBUG_TRACES = SIGNAL_CONTRACT.filter(entry => entry.kind === 'debug-trace');

/** LEGACY_SIGNALS are still used somewhere, but no new usage should be added. */
export const LEGACY_SIGNALS = SIGNAL_CONTRACT.filter(entry => entry.status === 'legacy');

/** DEPRECATED_SIGNALS are obsolete or conflicting entries with replacements; remove after callers are gone. */
export const DEPRECATED_SIGNALS = SIGNAL_CONTRACT.filter(entry => entry.status === 'deprecated');

export const SIGNALS = SIGNAL_CONTRACT
  .filter(entry => entry.kind === 'dom-signal' || entry.kind === 'window-signal')
  .map(entry => entry.name);
