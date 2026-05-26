import { afterEach, describe, expect, it } from 'vitest';
import { resolveNativeBrowserStrategy } from '../nativeBrowserStrategies';

const chromeUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const edgeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0';
const safariUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const genericUa = 'Mozilla/5.0 CustomBrowser/1.0';
const braveUaWithToken = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Brave/1.77.101';
const arcUaWithToken = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Arc/1.89.0';
const operaUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 OPR/115.0.0.0';
const samsungUa = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const electronUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) MyApp/1.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36';
const chromeIosUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/148.0.0.0 Mobile/15E148 Safari/604.1';

function result(transcript: string, isFinal: boolean) {
  return Object.assign([{ transcript }], { isFinal });
}

describe('native browser strategies', () => {
  afterEach(() => {
    delete (globalThis as {
      __NATIVE_STT_DIAGNOSTIC_CONFIG__?: unknown;
    }).__NATIVE_STT_DIAGNOSTIC_CONFIG__;
  });

  it('routes Chrome to a verified Web Speech strategy and Edge to a Chromium-compatible strategy until Edge proof exists', () => {
    expect(resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeUa }).browserFamily).toBe('chrome');
    const edgeStrategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: edgeUa });
    expect(edgeStrategy.browserFamily).toBe('edge');
    expect(edgeStrategy.compatibilityMode).toBe('chromium-compatible');
    expect(edgeStrategy.userMessage).toMatch(/Chrome is recommended/i);
  });

  it('uses browser hints before UA fallback when Chromium browsers expose them', () => {
    const plainChromiumUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

    expect(resolveNativeBrowserStrategy({
      hasSpeechRecognition: true,
      userAgent: plainChromiumUa,
      isBrave: true,
    }).browserFamily).toBe('brave');

    expect(resolveNativeBrowserStrategy({
      hasSpeechRecognition: true,
      userAgent: plainChromiumUa,
      browserBrands: ['Chromium', 'Microsoft Edge'],
    }).browserFamily).toBe('edge');
  });

  it('keeps Chrome and Edge in continuous dictation mode', () => {
    const chromeStrategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeUa });
    const edgeStrategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: edgeUa });
    const chromeRecognition = { interimResults: false, continuous: false, maxAlternatives: 1 };
    const edgeRecognition = { interimResults: false, continuous: false, maxAlternatives: 1 };

    chromeStrategy.configure(chromeRecognition);
    edgeStrategy.configure(edgeRecognition);

    expect(chromeRecognition.continuous).toBe(true);
    expect(edgeRecognition.continuous).toBe(true);
  });

  it('keeps Safari explicitly non-continuous', () => {
    const safariStrategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: safariUa });
    const safariRecognition = { interimResults: false, continuous: true, maxAlternatives: 4 };

    safariStrategy.configure(safariRecognition);

    expect(safariRecognition.continuous).toBe(false);
    expect(safariRecognition.interimResults).toBe(true);
    expect(safariRecognition.maxAlternatives).toBe(1);
  });

  it('keeps generic SpeechRecognition browsers in continuous dictation mode', () => {
    const genericStrategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: genericUa });
    const genericRecognition = { interimResults: true, continuous: false, maxAlternatives: 1 };

    genericStrategy.configure(genericRecognition);

    expect(genericRecognition.continuous).toBe(true);
  });

  it('applies the dictation baseline to Chromium-compatible browsers without claiming verified Chrome', () => {
    const cases = [
      [braveUaWithToken, 'brave'],
      [arcUaWithToken, 'arc'],
      [operaUa, 'opera'],
      [samsungUa, 'samsung'],
      [electronUa, 'electron'],
    ] as const;

    for (const [userAgent, browserFamily] of cases) {
      const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent });
      const recognition = { interimResults: false, continuous: false, maxAlternatives: 1 };

      strategy.configure(recognition);

      expect(strategy.browserFamily).toBe(browserFamily);
      expect(strategy.compatibilityMode).toBe('chromium-compatible');
      expect(recognition.continuous).toBe(true);
      expect(recognition.interimResults).toBe(true);
      expect(recognition.maxAlternatives).toBe(1);
      expect(strategy.userMessage).toMatch(/Chrome is recommended/i);
    }
  });

  it('routes Chrome on iOS to an iOS WebKit-compatible strategy', () => {
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeIosUa });
    const recognition = { interimResults: false, continuous: true, maxAlternatives: 4 };

    strategy.configure(recognition);

    expect(strategy.browserFamily).toBe('chrome-ios');
    expect(strategy.compatibilityMode).toBe('webkit-compatible');
    expect(recognition.continuous).toBe(false);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.maxAlternatives).toBe(1);
    expect(strategy.userMessage).toMatch(/iOS Web Speech/i);
  });

  it('routes Safari to a verified Safari strategy', () => {
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: safariUa });
    expect(strategy.browserFamily).toBe('safari');
    expect(strategy.compatibilityMode).toBe('verified');
  });

  it('routes unknown browsers with SpeechRecognition to generic compatibility mode', () => {
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: genericUa });
    expect(strategy.browserFamily).toBe('generic');
    expect(strategy.compatibilityMode).toBe('generic');
    expect(strategy.userMessage).toMatch(/compatibility mode/i);
  });

  it('routes browsers without SpeechRecognition to unsupported with explicit message', () => {
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: false, userAgent: genericUa });
    expect(strategy.browserFamily).toBe('unsupported');
    expect(strategy.compatibilityMode).toBe('unsupported');
    expect(strategy.userMessage).toMatch(/does not provide a usable SpeechRecognition API/i);
  });

  it('applies non-production Native diagnostic URL overrides', () => {
    (globalThis as {
      __NATIVE_STT_DIAGNOSTIC_CONFIG__?: {
        continuous: boolean;
        interimResults: boolean;
        maxAlternatives: number;
      };
    }).__NATIVE_STT_DIAGNOSTIC_CONFIG__ = {
      continuous: true,
      interimResults: false,
      maxAlternatives: 3,
    };
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeUa });
    const recognition = {
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
    };

    strategy.configure(recognition);

    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(false);
    expect(recognition.maxAlternatives).toBe(3);
  });

  it('ignores malformed Native diagnostic URL overrides', () => {
    (globalThis as {
      __NATIVE_STT_DIAGNOSTIC_CONFIG__?: {
        continuous: unknown;
        interimResults: unknown;
        maxAlternatives: unknown;
      };
    }).__NATIVE_STT_DIAGNOSTIC_CONFIG__ = {
      continuous: 'maybe',
      interimResults: 'maybe',
      maxAlternatives: 99,
    };
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeUa });
    const recognition = {
      interimResults: false,
      continuous: true,
      maxAlternatives: 4,
    };

    strategy.configure(recognition);

    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.maxAlternatives).toBe(1);
  });

  it('extracts latest interim hypotheses by Web Speech result slots', () => {
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeUa });
    const finalized = new Set<number>();
    const update = strategy.extractTranscripts({
      resultIndex: 0,
      results: [result('like lingers on', false), result('a dash of pepper', false)],
    }, finalized);

    expect(update.finalTranscript).toBe('');
    expect(update.interimTranscript).toBe('like lingers on a dash of pepper');
  });

  it('preserves all active interim result slots even when only a later slot changed', () => {
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeUa });
    const finalized = new Set<number>();
    const update = strategy.extractTranscripts({
      resultIndex: 1,
      results: [result('like lingers on', false), result('a dash of pepper', false)],
    }, finalized);

    expect(update.rawResults).toEqual([
      { index: 0, isFinal: false, transcript: 'like lingers on' },
      { index: 1, isFinal: false, transcript: 'a dash of pepper' },
    ]);
    expect(update.finalTranscript).toBe('');
    expect(update.interimTranscript).toBe('like lingers on a dash of pepper');
  });

  it('does not re-emit earlier final result slots while preserving current interim slots', () => {
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeUa });
    const finalized = new Set<number>([0]);
    const update = strategy.extractTranscripts({
      resultIndex: 1,
      results: [result('native browser proof', true), result('the quick brown fox', false)],
    }, finalized);

    expect(update.finalTranscript).toBe('');
    expect(update.interimTranscript).toBe('the quick brown fox');
  });

  it('emits each final result slot only once', () => {
    const strategy = resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeUa });
    const finalized = new Set<number>();
    const first = strategy.extractTranscripts({
      resultIndex: 0,
      results: [result('hello world', true)],
    }, finalized);
    const second = strategy.extractTranscripts({
      resultIndex: 0,
      results: [result('hello world', true)],
    }, finalized);

    expect(first.finalTranscript).toBe('hello world');
    expect(second.finalTranscript).toBe('');
  });
});
