import { describe, expect, it } from 'vitest';
import { resolveNativeBrowserStrategy } from '../nativeBrowserStrategies';

const chromeUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const edgeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0';
const safariUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const genericUa = 'Mozilla/5.0 CustomBrowser/1.0';

function result(transcript: string, isFinal: boolean) {
  return Object.assign([{ transcript }], { isFinal });
}

describe('native browser strategies', () => {
  it('routes Chrome and Edge to verified Web Speech strategies', () => {
    expect(resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: chromeUa }).browserFamily).toBe('chrome');
    expect(resolveNativeBrowserStrategy({ hasSpeechRecognition: true, userAgent: edgeUa }).browserFamily).toBe('edge');
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
