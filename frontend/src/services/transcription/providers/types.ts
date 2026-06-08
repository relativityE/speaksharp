import type { TranscriptionMode } from '../TranscriptionPolicy';

// Mode is the user-facing product path: Browser, Private, or Cloud.
// Provider is the replaceable implementation behind that mode.
export type SttMode = Exclude<TranscriptionMode, 'mock'>;

export type NativeSttProvider =
  | 'auto-browser'
  | 'chrome'
  | 'edge'
  | 'chrome-ios'
  | 'brave'
  | 'arc'
  | 'opera'
  | 'samsung'
  | 'electron'
  | 'safari'
  | 'generic'
  | 'unsupported';

export type PrivateSttProvider =
  | 'transformers-js'
  | 'transformers-js-v4';

export type CloudSttProvider =
  | 'assemblyai'
  | 'deepgram';

export type SttProvider = NativeSttProvider | PrivateSttProvider | CloudSttProvider;

export type ProviderStatus = 'active' | 'available' | 'future' | 'unsupported';

export type SttProviderEntry<TProvider extends SttProvider = SttProvider> = {
  id: TProvider;
  status: ProviderStatus;
  registryKey?: string;
  displayName: string;
  intent: string;
};

export type SttModeProviderConfig<TProvider extends SttProvider = SttProvider> = {
  mode: SttMode;
  defaultProvider: TProvider;
  providers: readonly SttProviderEntry<TProvider>[];
};
