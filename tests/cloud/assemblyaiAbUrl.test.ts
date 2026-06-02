import { describe, it, expect } from 'vitest';
import {
  buildAbStreamingUrl,
  speechModelForVariant,
  AB_DEFAULT_SPEECH_MODEL,
  AB_PROMPT_SPEECH_MODEL,
  type AbVariant,
} from '../../scripts/lib/assemblyaiAbUrl';

/**
 * No-network proof that each A/B variant builds the request shape AssemblyAI
 * Universal Streaming v3 actually accepts — encoding the fixes proven by the
 * credentialed run 26830845676:
 *   - prompt only on u3-rt-pro (else error 3006)
 *   - keyterms_prompt as REPEATED params (not a JSON.stringify array)
 */
const base = {
  token: 'TEST_TOKEN',
  sampleRateHz: 16_000,
  encoding: 'pcm_s16le',
  keyterms: ['speaksharp', 'filler', 'um'],
  prompt: 'Transcribe verbatim for speech coaching.',
};

const paramsOf = (variant: AbVariant) =>
  new URL(buildAbStreamingUrl({ ...base, variant })).searchParams;

describe('assemblyai A/B streaming URL builder', () => {
  it('baseline: default model, no prompt, no keyterms_prompt', () => {
    const p = paramsOf('baseline');
    expect(p.get('speech_model')).toBe(AB_DEFAULT_SPEECH_MODEL);
    expect(p.get('format_turns')).toBe('true');
    expect(p.get('sample_rate')).toBe('16000');
    expect(p.has('prompt')).toBe(false);
    expect(p.getAll('keyterms_prompt')).toHaveLength(0);
  });

  it('keyterms: baseline model, keyterms as REPEATED params, no prompt', () => {
    const p = paramsOf('keyterms');
    expect(p.get('speech_model')).toBe(AB_DEFAULT_SPEECH_MODEL);
    expect(p.getAll('keyterms_prompt')).toEqual(['speaksharp', 'filler', 'um']);
    expect(p.has('prompt')).toBe(false);
  });

  it('prompt: switches to u3-rt-pro and includes prompt, no keyterms', () => {
    const p = paramsOf('prompt');
    expect(p.get('speech_model')).toBe(AB_PROMPT_SPEECH_MODEL);
    expect(p.get('prompt')).toBe(base.prompt);
    expect(p.getAll('keyterms_prompt')).toHaveLength(0);
  });

  it('prompt_keyterms: u3-rt-pro, prompt AND repeated keyterms', () => {
    const p = paramsOf('prompt_keyterms');
    expect(p.get('speech_model')).toBe(AB_PROMPT_SPEECH_MODEL);
    expect(p.get('prompt')).toBe(base.prompt);
    expect(p.getAll('keyterms_prompt')).toEqual(['speaksharp', 'filler', 'um']);
  });

  it('regression: keyterms_prompt is never a JSON.stringify array blob', () => {
    const raw = buildAbStreamingUrl({ ...base, variant: 'prompt_keyterms' });
    // The original bug encoded keyterms as '["speaksharp","filler","um"]'.
    expect(raw).not.toContain(encodeURIComponent('["'));
    expect(raw).not.toContain('%5B%22'); // url-encoded [" — the JSON-array signature
  });

  it('speechModelForVariant: only prompt variants escalate the model', () => {
    expect(speechModelForVariant('baseline')).toBe(AB_DEFAULT_SPEECH_MODEL);
    expect(speechModelForVariant('keyterms')).toBe(AB_DEFAULT_SPEECH_MODEL);
    expect(speechModelForVariant('prompt')).toBe(AB_PROMPT_SPEECH_MODEL);
    expect(speechModelForVariant('prompt_keyterms')).toBe(AB_PROMPT_SPEECH_MODEL);
  });

  it('empty/whitespace keyterms are dropped, not sent as blank params', () => {
    const p = new URL(
      buildAbStreamingUrl({ ...base, variant: 'keyterms', keyterms: ['  ', 'real', ''] }),
    ).searchParams;
    expect(p.getAll('keyterms_prompt')).toEqual(['real']);
  });
});
