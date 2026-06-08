import type {
  CloudSttProvider,
  NativeSttProvider,
  PrivateSttProvider,
  SttMode,
  SttModeProviderConfig,
  SttProvider,
  SttProviderEntry,
} from './types';

// Canonical STT mode/provider inventory.
//
// Mode = user-facing product path.
// Provider = swappable implementation behind that mode.
//
// This file is the single source of truth for provider defaults. Product code
// should read this config instead of hardcoding assemblyai, transformers-js,
// or browser strategy keys in factories.

const nativeProviders = [
  {
    id: 'auto-browser',
    status: 'active',
    registryKey: 'native-browser',
    displayName: 'Browser Auto Detection',
    intent: 'Detect the current browser and compose the best Web Speech strategy.',
  },
  {
    id: 'chrome',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Chrome Web Speech',
    intent: 'Verified Chrome desktop dictation-style Native STT path.',
  },
  {
    id: 'edge',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Edge Web Speech',
    intent: 'Chromium-compatible Native STT path; requires separate release proof before support claims.',
  },
  {
    id: 'chrome-ios',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Chrome iOS Web Speech',
    intent: 'iOS WebKit-backed Chrome path; uses conservative WebKit behavior.',
  },
  {
    id: 'brave',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Brave Web Speech',
    intent: 'Chromium-compatible Native STT path behind Brave browser detection.',
  },
  {
    id: 'arc',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Arc Web Speech',
    intent: 'Chromium-compatible Native STT path behind Arc browser detection.',
  },
  {
    id: 'opera',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Opera Web Speech',
    intent: 'Chromium-compatible Native STT path behind Opera browser detection.',
  },
  {
    id: 'samsung',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Samsung Internet Web Speech',
    intent: 'Chromium-compatible Native STT path behind Samsung Internet detection.',
  },
  {
    id: 'electron',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Electron Web Speech',
    intent: 'Chromium-compatible Native STT path for desktop shells and test harnesses.',
  },
  {
    id: 'safari',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Safari Web Speech',
    intent: 'WebKit-compatible Native STT path with conservative browser behavior.',
  },
  {
    id: 'generic',
    status: 'available',
    registryKey: 'native-browser',
    displayName: 'Generic Web Speech',
    intent: 'Compatibility fallback for browsers with partial SpeechRecognition support.',
  },
  {
    id: 'unsupported',
    status: 'unsupported',
    displayName: 'Unsupported Browser STT',
    intent: 'Explicit unavailable config path. Runtime browser detection can still classify a real browser as unsupported inside NativeBrowser.',
  },
] as const satisfies readonly SttProviderEntry<NativeSttProvider>[];

const privateProviders = [
  {
    id: 'transformers-js',
    status: 'active',
    registryKey: 'transformers-js',
    displayName: 'Transformers.js v2',
    intent: 'Current stable Private STT provider and safe fallback.',
  },
  {
    id: 'transformers-js-v4',
    status: 'available',
    registryKey: 'transformers-js-v4',
    displayName: 'Transformers.js v4',
    intent: 'Next Private STT provider candidate after journey/finalization proof.',
  },
] as const satisfies readonly SttProviderEntry<PrivateSttProvider>[];

const cloudProviders = [
  {
    id: 'assemblyai',
    status: 'active',
    registryKey: 'assemblyai',
    displayName: 'AssemblyAI Universal Streaming English',
    intent: 'Current Cloud STT provider using AssemblyAI v3 Begin/Turn streaming protocol.',
  },
  {
    id: 'deepgram',
    status: 'future',
    displayName: 'Deepgram Streaming',
    intent: 'Selectable future Cloud STT provider. If chosen before implementation, the factory must fail loudly.',
  },
] as const satisfies readonly SttProviderEntry<CloudSttProvider>[];

export const STT_MODE_PROVIDER_CONFIG = {
  native: {
    mode: 'native',
    defaultProvider: 'auto-browser',
    providers: nativeProviders,
  },
  private: {
    mode: 'private',
    defaultProvider: 'transformers-js',
    providers: privateProviders,
  },
  cloud: {
    mode: 'cloud',
    defaultProvider: 'assemblyai',
    providers: cloudProviders,
  },
} as const satisfies Record<SttMode, SttModeProviderConfig>;

export function getModeProviderConfig(mode: SttMode): SttModeProviderConfig {
  return STT_MODE_PROVIDER_CONFIG[mode] as SttModeProviderConfig;
}

export function getDefaultProviderForMode(mode: SttMode): SttProvider {
  return getModeProviderConfig(mode).defaultProvider;
}

export function getProviderEntry(mode: SttMode, provider: SttProvider): SttProviderEntry | undefined {
  return getModeProviderConfig(mode).providers.find((entry) => entry.id === provider);
}

export function getDefaultProviderEntry(mode: SttMode): SttProviderEntry {
  const provider = getDefaultProviderForMode(mode);
  const entry = getProviderEntry(mode, provider);
  if (!entry) {
    throw new Error(`[STTProviderConfig] Missing default provider "${provider}" for mode "${mode}".`);
  }
  return entry;
}

export function getRegistryKeyForMode(mode: SttMode): string {
  return getDefaultProviderEntry(mode).registryKey ?? getDefaultProviderForMode(mode);
}

export function getProviderIdsForMode(mode: SttMode): SttProvider[] {
  return getModeProviderConfig(mode).providers.map((entry) => entry.id);
}
