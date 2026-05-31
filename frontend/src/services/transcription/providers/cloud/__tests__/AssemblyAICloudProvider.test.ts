import { describe, expect, it, vi } from 'vitest';
import { AssemblyAICloudProvider, buildAssemblyAICloudKeyterms, buildAssemblyAICloudPrompt } from '../AssemblyAICloudProvider';

vi.mock('../../../utils/AudioProcessor', () => ({
  floatToInt16: vi.fn((float32Array: Float32Array) => new Int16Array(float32Array.length)),
}));

describe('AssemblyAICloudProvider', () => {
  it('builds the v3 Universal Streaming URL and encodes custom terms as keyterms_prompt', () => {
    const provider = new AssemblyAICloudProvider();
    const url = new URL(provider.buildWebSocketUrl({
      token: { token: 'token-123' },
      customTerms: ['canary', 'speaksharp'],
    }));

    expect(`${url.origin}${url.pathname}`).toBe('wss://streaming.assemblyai.com/v3/ws');
    expect(url.searchParams.get('speech_model')).toBe('universal-streaming-english');
    expect(url.searchParams.get('encoding')).toBe('pcm_s16le');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('format_turns')).toBe('true');
    expect(url.searchParams.get('token')).toBe('token-123');
    expect(JSON.parse(url.searchParams.get('keyterms_prompt') ?? '[]')).toEqual(expect.arrayContaining([
      'um',
      'uh',
      'canary',
      'speaksharp',
    ]));
    expect(url.searchParams.get('prompt')).toContain('Preserve filler words');
    expect(url.searchParams.get('prompt')).toContain('canary');
  });

  it('builds a verbatim coaching prompt from default and custom keyterms', () => {
    const prompt = buildAssemblyAICloudPrompt(['um', 'you know', 'canary']);

    expect(prompt).toContain('Transcribe verbatim');
    expect(prompt).toContain('Preserve filler words');
    expect(prompt).toContain('um, you know, canary');
  });

  it('parses Begin as provider-ready metadata', () => {
    const provider = new AssemblyAICloudProvider();

    expect(provider.parseMessage(JSON.stringify({ type: 'Begin', id: 'session-1' }))).toEqual([{
      type: 'provider-ready',
      sessionId: 'session-1',
      metadata: {
        provider: 'assemblyai',
        providerModel: 'universal-streaming-english',
        messageType: 'Begin',
      },
    }]);
  });

  it('parses v3 partial Turn text from words when transcript and utterance are empty', () => {
    const provider = new AssemblyAICloudProvider();

    expect(provider.parseMessage(JSON.stringify({
      type: 'Turn',
      transcript: '',
      utterance: '',
      end_of_turn: false,
      words: [
        { text: 'On', word_is_final: false },
        { text: 'track', word_is_final: false },
      ],
    }))).toEqual([{
      type: 'partial',
      text: 'On track',
      speaker: undefined,
      confidence: undefined,
    }]);
  });

  it('prefers v3 Turn transcript for live partial/current turn text', () => {
    const provider = new AssemblyAICloudProvider();

    expect(provider.parseMessage(JSON.stringify({
      type: 'Turn',
      transcript: 'Today I want',
      end_of_turn: false,
      words: [
        { text: 'Today', word_is_final: true },
        { text: 'I', word_is_final: true },
        { text: 'want', word_is_final: true },
        { text: 'to', word_is_final: false },
        { text: 'test', word_is_final: false },
      ],
    }))).toEqual([{
      type: 'partial',
      text: 'Today I want',
      speaker: undefined,
      confidence: undefined,
    }]);
  });

  it('falls back to word text when partial Turn transcript is empty', () => {
    const provider = new AssemblyAICloudProvider();

    expect(provider.parseMessage(JSON.stringify({
      type: 'Turn',
      transcript: '',
      end_of_turn: false,
      words: [
        { text: 'Today', word_is_final: true },
        { text: 'I', word_is_final: true },
        { text: 'want', word_is_final: true },
        { text: 'to', word_is_final: false },
        { text: 'test', word_is_final: false },
      ],
    }))).toEqual([{
      type: 'partial',
      text: 'Today I want to test',
      speaker: undefined,
      confidence: undefined,
    }]);
  });

  it('parses v3 final Turn text and termination', () => {
    const provider = new AssemblyAICloudProvider();

    expect(provider.parseMessage(JSON.stringify({
      type: 'Turn',
      transcript: 'Release validation passed.',
      end_of_turn: true,
      confidence: 0.91,
    }))).toEqual([{
      type: 'final',
      text: 'Release validation passed.',
      speaker: undefined,
      confidence: 0.91,
    }]);

    expect(provider.parseMessage(JSON.stringify({ type: 'Termination' }))).toEqual([{ type: 'terminated' }]);
  });

  it('declares audio policy and termination message', () => {
    const provider = new AssemblyAICloudProvider();
    expect(provider.getAudioPolicy()).toMatchObject({
      sampleRateHz: 16000,
      encoding: 'pcm_s16le',
      minPacketSamples: 800,
      canStreamBeforeProviderReady: false,
    });
    expect(provider.buildTerminateMessage()).toBe(JSON.stringify({ type: 'Terminate' }));
  });

  it('normalizes default and user custom terms for provider-owned encoding', () => {
    expect(buildAssemblyAICloudKeyterms(['Canary', 'canary', 'SpeakSharp'])).toEqual(expect.arrayContaining([
      'um',
      'uh',
      'canary',
      'speaksharp',
    ]));
  });
});
