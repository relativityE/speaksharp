import type {
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

export const STT_MODE_PROVIDER_CONFIG = {
  private: {
    mode: 'private',
    defaultProvider: 'transformers-js',
    providers: privateProviders,
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
