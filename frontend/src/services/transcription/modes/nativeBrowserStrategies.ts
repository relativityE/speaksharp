import { NATIVE_STT } from '../sttConstants';

type BrowserFamily = 'chrome' | 'edge' | 'safari' | 'generic' | 'unsupported';
type CompatibilityMode = 'verified' | 'generic' | 'unsupported';

type RecognitionLike = {
  lang?: string;
  interimResults: boolean;
  continuous: boolean;
};

type RecognitionResultLike = {
  isFinal: boolean;
  [key: number]: { transcript?: string };
};

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

const isChromiumFamily = (ua: string): boolean =>
  /Chrome|Chromium|CriOS/i.test(ua) && !/Edg|OPR|Opera|Brave|Arc|SamsungBrowser/i.test(ua);

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

  for (let i = 0; i < event.results.length; i += 1) {
    const result = event.results[i];
    const transcript = normalizeTranscript(result?.[0]?.transcript ?? '');
    const isFinal = Boolean(result?.isFinal);
    rawResults.push({ index: i, isFinal, transcript });

    if (!transcript) continue;

    if (isFinal) {
      if (i >= event.resultIndex && !finalizedResultIndexes.has(i)) {
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

const configureStandardWebSpeech = (recognition: RecognitionLike) => {
  recognition.lang = NATIVE_STT.LANG;
  recognition.interimResults = NATIVE_STT.INTERIM_RESULTS;
  recognition.continuous = NATIVE_STT.CONTINUOUS;
};

const makeStrategy = (
  browserFamily: BrowserFamily,
  compatibilityMode: CompatibilityMode,
  userMessage: string | null,
): NativeBrowserStrategy => ({
  browserFamily,
  compatibilityMode,
  userMessage,
  configure: configureStandardWebSpeech,
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
    );
  }

  const browserFamily = getBrowserFamily(options.userAgent);

  if (browserFamily === 'chrome' || browserFamily === 'edge') {
    return makeStrategy(browserFamily, 'verified', null);
  }

  if (browserFamily === 'safari') {
    return makeStrategy(
      'safari',
      'verified',
      'Browser STT is using the Safari Web Speech implementation. Results may vary; switch to Private STT or Cloud STT if transcription is delayed or incomplete.',
    );
  }

  return makeStrategy(
    'generic',
    'generic',
    'Browser STT is running in compatibility mode for this browser. Results may vary. If transcription is delayed or incomplete, switch to Private STT or Cloud STT.',
  );
}
