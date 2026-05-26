import { NATIVE_STT } from '../sttConstants';

type BrowserFamily = 'chrome' | 'edge' | 'safari' | 'generic' | 'unsupported';
type CompatibilityMode = 'verified' | 'generic' | 'unsupported';

type RecognitionLike = {
  lang?: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives?: number;
};

type RecognitionResultLike = {
  isFinal: boolean;
  [key: number]: { transcript?: string };
};

type NativeDiagnosticConfigOverride = {
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
};

type NativeDiagnosticGlobal = typeof globalThis & {
  __NATIVE_STT_DIAGNOSTIC_CONFIG__?: NativeDiagnosticConfigOverride;
};

type WebSpeechConfig = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
};

type CommonWebSpeechConfig = Omit<WebSpeechConfig, 'continuous'>;
type WebSpeechConfigLayer = Partial<WebSpeechConfig>;

export type RecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
};

export type NativeBrowserStrategy = {
  browserFamily: BrowserFamily;
  compatibilityMode: CompatibilityMode;
  userMessage: string | null;
  configure: (recognition: RecognitionLike) => void;
  extractTranscripts: (event: RecognitionEventLike, finalizedResultIndexes: Set<number>) => {
    finalTranscript: string;
    interimTranscript: string;
    rawResults: Array<{ index: number; isFinal: boolean; transcript: string }>;
  };
};

const normalizeTranscript = (value: string): string => value.replace(/\s+/g, ' ').trim();

const COMMON_WEB_SPEECH_CONFIG: CommonWebSpeechConfig = {
  lang: NATIVE_STT.LANG,
  interimResults: NATIVE_STT.INTERIM_RESULTS,
  maxAlternatives: NATIVE_STT.MAX_ALTERNATIVES,
};

const DICTATION_WEB_SPEECH_CONFIG: WebSpeechConfigLayer = {
  continuous: true,
};

const SAFARI_WEB_SPEECH_OVERRIDES: WebSpeechConfigLayer = {
  continuous: false,
};

const composeWebSpeechConfig = (...layers: WebSpeechConfigLayer[]): WebSpeechConfig => {
  const config = Object.assign({}, COMMON_WEB_SPEECH_CONFIG, ...layers) as Partial<WebSpeechConfig>;
  if (typeof config.continuous !== 'boolean') {
    throw new Error('Native Web Speech strategy must define continuous mode.');
  }

  return config as WebSpeechConfig;
};

const CHROME_WEB_SPEECH_CONFIG = composeWebSpeechConfig(DICTATION_WEB_SPEECH_CONFIG);
const EDGE_WEB_SPEECH_CONFIG = composeWebSpeechConfig(DICTATION_WEB_SPEECH_CONFIG);
const SAFARI_WEB_SPEECH_CONFIG = composeWebSpeechConfig(
  DICTATION_WEB_SPEECH_CONFIG,
  SAFARI_WEB_SPEECH_OVERRIDES,
);
const GENERIC_WEB_SPEECH_CONFIG = composeWebSpeechConfig(DICTATION_WEB_SPEECH_CONFIG);
const UNSUPPORTED_WEB_SPEECH_CONFIG = GENERIC_WEB_SPEECH_CONFIG;

const isDiagnosticConfigAllowed = (): boolean => import.meta.env.MODE !== 'production';

const parseBooleanParam = (value: string | null): boolean | undefined => {
  if (value == null) return undefined;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  return undefined;
};

const parseMaxAlternativesParam = (value: string | null): number | undefined => {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) return undefined;
  return parsed;
};

const getNativeDiagnosticConfigOverride = (): NativeDiagnosticConfigOverride => {
  if (!isDiagnosticConfigAllowed()) return {};

  const globalOverride = (globalThis as NativeDiagnosticGlobal).__NATIVE_STT_DIAGNOSTIC_CONFIG__;
  if (globalOverride) {
    return {
      continuous: typeof globalOverride.continuous === 'boolean' ? globalOverride.continuous : undefined,
      interimResults: typeof globalOverride.interimResults === 'boolean' ? globalOverride.interimResults : undefined,
      maxAlternatives: parseMaxAlternativesParam(String(globalOverride.maxAlternatives ?? '')),
    };
  }

  if (typeof window === 'undefined') return {};

  const params = new URLSearchParams(window.location.search);
  return {
    continuous: parseBooleanParam(params.get('nativeContinuous')),
    interimResults: parseBooleanParam(params.get('nativeInterimResults')),
    maxAlternatives: parseMaxAlternativesParam(params.get('nativeMaxAlternatives')),
  };
};

const isChromiumFamily = (ua: string): boolean =>
  /Chrome|Chromium|CriOS/i.test(ua) && !/Edg/i.test(ua);

const isEdge = (ua: string): boolean => /Edg/i.test(ua);

const isSafari = (ua: string): boolean =>
  /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Opera/i.test(ua);

const getBrowserFamily = (ua: string): BrowserFamily => {
  if (isEdge(ua)) return 'edge';
  if (isChromiumFamily(ua)) return 'chrome';
  if (isSafari(ua)) return 'safari';
  return 'generic';
};

const extractByWebSpeechContract = (
  event: RecognitionEventLike,
  finalizedResultIndexes: Set<number>,
): ReturnType<NativeBrowserStrategy['extractTranscripts']> => {
  const rawResults: Array<{ index: number; isFinal: boolean; transcript: string }> = [];
  const interimParts: string[] = [];
  const finalParts: string[] = [];

  const firstChangedIndex = Math.max(0, event.resultIndex ?? 0);

  for (let i = 0; i < event.results.length; i += 1) {
    const result = event.results[i];
    const transcript = normalizeTranscript(result?.[0]?.transcript ?? '');
    const isFinal = Boolean(result?.isFinal);
    rawResults.push({ index: i, isFinal, transcript });

    if (!transcript) continue;

    if (isFinal) {
      if (i >= firstChangedIndex && !finalizedResultIndexes.has(i)) {
        finalizedResultIndexes.add(i);
        finalParts.push(transcript);
      }
    } else {
      interimParts.push(transcript);
    }
  }

  return {
    finalTranscript: finalParts.join(' ').trim(),
    interimTranscript: interimParts.join(' ').trim(),
    rawResults,
  };
};

const configureStandardWebSpeech = (
  recognition: RecognitionLike,
  config: WebSpeechConfig,
) => {
  const override = getNativeDiagnosticConfigOverride();
  recognition.lang = config.lang;
  recognition.interimResults = override.interimResults ?? config.interimResults;
  recognition.continuous = override.continuous ?? config.continuous;
  recognition.maxAlternatives = override.maxAlternatives ?? config.maxAlternatives;
};

const makeStrategy = (
  browserFamily: BrowserFamily,
  compatibilityMode: CompatibilityMode,
  userMessage: string | null,
  config: WebSpeechConfig,
): NativeBrowserStrategy => ({
  browserFamily,
  compatibilityMode,
  userMessage,
  configure: (recognition) => configureStandardWebSpeech(recognition, config),
  extractTranscripts: extractByWebSpeechContract,
});

export function resolveNativeBrowserStrategy(options: {
  hasSpeechRecognition: boolean;
  userAgent: string;
}): NativeBrowserStrategy {
  if (!options.hasSpeechRecognition) {
    return makeStrategy(
      'unsupported',
      'unsupported',
      'This browser does not provide a usable SpeechRecognition API, so Browser STT cannot run here. Use Private STT or Cloud STT instead.',
      UNSUPPORTED_WEB_SPEECH_CONFIG,
    );
  }

  const browserFamily = getBrowserFamily(options.userAgent);

  if (browserFamily === 'chrome') {
    return makeStrategy('chrome', 'verified', null, CHROME_WEB_SPEECH_CONFIG);
  }

  if (browserFamily === 'edge') {
    return makeStrategy('edge', 'verified', null, EDGE_WEB_SPEECH_CONFIG);
  }

  if (browserFamily === 'safari') {
    return makeStrategy(
      'safari',
      'verified',
      'Browser STT is using the Safari Web Speech implementation. Results may vary; switch to Private STT or Cloud STT if transcription is delayed or incomplete.',
      SAFARI_WEB_SPEECH_CONFIG,
    );
  }

  return makeStrategy(
    'generic',
    'generic',
    'Browser STT is running in compatibility mode for this browser. Results may vary. If transcription is delayed or incomplete, switch to Private STT or Cloud STT.',
    GENERIC_WEB_SPEECH_CONFIG,
  );
}
