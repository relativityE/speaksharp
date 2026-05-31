import { getSupabaseClient } from '../../../../lib/supabaseClient';
import logger from '../../../../lib/logger';
import { FILLER_WORD_KEYS } from '../../../../config';
import { floatToInt16 } from '../../utils/AudioProcessor';
import { CLOUD_STT, CLOUD_STT_DERIVED } from '../../sttConstants';
import type {
  CloudAuthContext,
  CloudAudioPolicy,
  CloudCloseClassification,
  CloudConnectionContext,
  CloudProviderCapabilities,
  CloudProviderEvent,
  CloudSttProvider,
  CloudToken,
} from './types';

type AssemblyAIWord = {
  text?: string;
  start?: number;
  end?: number;
  confidence?: number;
  speaker?: string;
  word_is_final?: boolean;
};

type AssemblyAIMessage = {
  type?: 'Begin' | 'Turn' | 'Termination' | 'Error' | string;
  id?: string;
  text?: string;
  transcript?: string;
  utterance?: string;
  end_of_turn?: boolean;
  words?: AssemblyAIWord[];
  speaker?: string;
  confidence?: number;
  error?: string;
  code?: string;
  message?: string;
};

export const CLOUD_DEFAULT_KEYTERMS = [
  ...Object.values(FILLER_WORD_KEYS),
  'umm',
  'ummm',
  'uhm',
  'uhh',
  'uhhh',
  'er',
  'err',
  'ahm',
  'ahhh',
  "y'know",
  'ya know',
  'kinda',
  'sorta',
] as const;

export class AssemblyAICloudProvider implements CloudSttProvider {
  public readonly id = 'assemblyai';
  public readonly displayName = 'AssemblyAI Universal Streaming English';
  public readonly modelName = CLOUD_STT.SPEECH_MODEL;

  public getCapabilities(): CloudProviderCapabilities {
    return {
      interimResults: true,
      finalResults: true,
      confidenceScores: true,
      wordTimestamps: true,
      speakerLabels: false,
      customTerms: true,
      punctuation: true,
    };
  }

  public async getToken(context: CloudAuthContext): Promise<CloudToken> {
    if (context.isE2E) {
      logger.info(context.logContext, '[AssemblyAICloudProvider] Test/E2E mode - bypassing auth');
      return { token: context.getMockToken() };
    }

    try {
      const callbackToken = await context.modeOptions?.getAssemblyAIToken?.();
      if (callbackToken) {
        logger.info({
          ...context.logContext,
          source: 'modeOptions.getAssemblyAIToken',
        }, '[AssemblyAICloudProvider] token fetched');
        return { token: callbackToken };
      }

      const session = context.session ?? (await getSupabaseClient().auth.getSession()).data.session;
      const accessToken = session?.access_token;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assemblyai-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let body = '';
        try {
          body = await response.text();
        } catch (bodyError) {
          logger.warn({
            ...context.logContext,
            status: response.status,
            err: bodyError,
          }, '[AssemblyAICloudProvider] Token endpoint returned non-2xx, but response body could not be read');
        }
        throw new Error(`Auth failed: ${response.status} ${body.slice(0, 300)}`);
      }

      const data = await response.json() as { token?: unknown; expires_in?: unknown };
      if (typeof data.token !== 'string' || data.token.length === 0) {
        throw new Error('Auth failed: token endpoint returned no token');
      }

      logger.info({
        ...context.logContext,
        status: response.status,
        hasToken: true,
      }, '[AssemblyAICloudProvider] token fetched');

      return {
        token: data.token,
        expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : undefined,
      };
    } catch (error) {
      logger.error({
        ...context.logContext,
        err: error,
        message: error instanceof Error ? error.message : String(error),
      }, '[AssemblyAICloudProvider] Auth token fetch failed');

      if (context.isDevelopment) {
        logger.warn(context.logContext, '[AssemblyAICloudProvider] Falling back to mock token');
        return { token: context.getMockToken() };
      }

      throw error;
    }
  }

  public buildWebSocketUrl(context: CloudConnectionContext): string {
    const connectionParams = new URLSearchParams({
      sample_rate: String(CLOUD_STT.SAMPLE_RATE_HZ),
      encoding: CLOUD_STT.ENCODING,
      speech_model: CLOUD_STT.SPEECH_MODEL,
      format_turns: 'true',
      token: context.token.token,
    });

    const keyterms = buildAssemblyAICloudKeyterms(context.customTerms);
    if (keyterms.length > 0) {
      connectionParams.set('keyterms_prompt', JSON.stringify(keyterms));
      connectionParams.set('prompt', buildAssemblyAICloudPrompt(keyterms));
    }

    return `wss://streaming.assemblyai.com/v3/ws?${connectionParams.toString()}`;
  }

  public buildOpenMessage(): null {
    return null;
  }

  public getAudioPolicy(): CloudAudioPolicy {
    return {
      sampleRateHz: CLOUD_STT.SAMPLE_RATE_HZ,
      encoding: CLOUD_STT.ENCODING,
      minPacketSamples: CLOUD_STT_DERIVED.MIN_PACKET_SAMPLES,
      maxPacketSamples: CLOUD_STT_DERIVED.MAX_PACKET_SAMPLES,
      maxQueuedAudioFrames: CLOUD_STT.MAX_QUEUED_AUDIO_FRAMES,
      canStreamBeforeProviderReady: false,
    };
  }

  public encodeAudio(audio: Float32Array): ArrayBuffer {
    const result = floatToInt16(audio);
    const audioBuffer = new ArrayBuffer(result.byteLength);
    new Uint8Array(audioBuffer).set(new Uint8Array(result.buffer, result.byteOffset, result.byteLength));
    return audioBuffer;
  }

  public parseMessage(raw: string | ArrayBuffer): CloudProviderEvent[] {
    if (typeof raw !== 'string') return [];

    const data = JSON.parse(raw) as AssemblyAIMessage;
    const messageType = data.type ?? 'unknown';

    if (data.error) {
      return [{
        type: 'error',
        message: data.error,
        recoverable: false,
        code: data.code,
      }];
    }

    switch (messageType) {
      case 'Begin':
        return [{
          type: 'provider-ready',
          sessionId: data.id,
          metadata: {
            provider: this.id,
            providerModel: this.modelName,
            messageType,
          },
        }];

      case 'Turn': {
        const text = data.end_of_turn
          ? this.extractTurnText(data)
          : this.extractLiveTurnText(data);
        if (!text) return [];
        const eventType = data.end_of_turn ? 'final' : 'partial';
        return [{
          type: eventType,
          text,
          speaker: data.speaker,
          confidence: data.confidence,
        }];
      }

      case 'Termination':
        return [{ type: 'terminated' }];

      case 'Error':
        return [{
          type: 'error',
          message: data.message ?? 'AssemblyAI streaming error',
          recoverable: false,
          code: data.code,
        }];

      default:
        return [];
    }
  }

  public buildTerminateMessage(): string {
    return JSON.stringify({ type: 'Terminate' });
  }

  public classifyClose(event: CloseEvent): CloudCloseClassification {
    const reason = event.reason || (event.wasClean ? 'clean-close' : 'socket-closed');
    const authLikeFailure = /token|auth|unauthor|expired|credential/i.test(reason);

    return {
      recoverable: !event.wasClean || authLikeFailure,
      reason,
      requiresNewToken: authLikeFailure,
      shouldPreserveTranscript: true,
    };
  }

  private extractTurnText(data: AssemblyAIMessage): string {
    const directText = data.text ?? data.transcript ?? data.utterance;
    if (typeof directText === 'string' && directText.trim()) {
      return directText.trim();
    }

    return this.extractWordText(data);
  }

  private extractLiveTurnText(data: AssemblyAIMessage): string {
    return this.extractTurnText(data) || this.extractWordText(data);
  }

  private extractWordText(data: AssemblyAIMessage): string {
    const wordText = data.words
      ?.map((word) => word.text?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
      .trim();

    return wordText ?? '';
  }
}

export function buildAssemblyAICloudKeyterms(userWords: string[] = []): string[] {
  const seen = new Set<string>();

  return [...CLOUD_DEFAULT_KEYTERMS, ...userWords]
    .map((word) => word.trim())
    .filter((word) => {
      if (!word) return false;
      const normalized = word.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .map((word) => word.toLowerCase());
}

export function buildAssemblyAICloudPrompt(keyterms: string[]): string {
  const highlightedTerms = keyterms.slice(0, 30).join(', ');
  return [
    'Transcribe verbatim for speech coaching.',
    'Preserve filler words, repetitions, self-corrections, and disfluencies when spoken.',
    highlightedTerms ? `Pay special attention to these coaching terms: ${highlightedTerms}.` : '',
  ].filter(Boolean).join(' ');
}
