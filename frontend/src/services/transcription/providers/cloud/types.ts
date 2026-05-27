import type { Session } from '@supabase/supabase-js';
import type { TranscriptionModeOptions } from '../../modes/types';

export type CloudProviderCapabilities = {
  interimResults: boolean;
  finalResults: boolean;
  confidenceScores: boolean;
  wordTimestamps: boolean;
  speakerLabels: boolean;
  customTerms: boolean;
  punctuation: boolean;
};

export type CloudAudioPolicy = {
  sampleRateHz: number;
  encoding: string;
  minPacketSamples: number;
  maxPacketSamples: number;
  maxQueuedAudioFrames: number;
  canStreamBeforeProviderReady: boolean;
};

export type CloudToken = {
  token: string;
  expiresInSeconds?: number;
};

export type CloudAuthContext = {
  modeOptions: TranscriptionModeOptions | null;
  session: Session | null;
  isE2E: boolean;
  isDevelopment: boolean;
  getMockToken: () => string;
  logContext: Record<string, unknown>;
};

export type CloudConnectionContext = {
  token: CloudToken;
  customTerms: string[];
};

export type CloudCloseClassification = {
  recoverable: boolean;
  reason: string;
  requiresNewToken?: boolean;
  shouldPreserveTranscript?: boolean;
};

export type CloudProviderEvent =
  | { type: 'provider-ready'; sessionId?: string; metadata?: Record<string, unknown> }
  | { type: 'partial'; text: string; speaker?: string; confidence?: number }
  | { type: 'final'; text: string; speaker?: string; confidence?: number }
  | { type: 'error'; message: string; recoverable?: boolean; code?: string }
  | { type: 'terminated' };

export type CloudProviderMetadata = {
  engineVersion: string;
  modelName: string;
  deviceType: 'cloud';
  provider: string;
  providerModel: string;
  providerSessionId: string | null;
  connectionStartedAt?: string;
  connectionClosedAt?: string;
  connectionDurationSeconds?: number;
  terminationReason?: string;
};

export interface CloudSttProvider {
  readonly id: string;
  readonly displayName: string;
  readonly modelName: string;

  getCapabilities(): CloudProviderCapabilities;
  getToken(context: CloudAuthContext): Promise<CloudToken>;
  buildWebSocketUrl(context: CloudConnectionContext): string;
  buildOpenMessage?(context: CloudConnectionContext): string | ArrayBuffer | null;
  getAudioPolicy(): CloudAudioPolicy;
  encodeAudio(audio: Float32Array): ArrayBuffer | string;
  parseMessage(raw: string | ArrayBuffer): CloudProviderEvent[];
  buildTerminateMessage(): string | ArrayBuffer | null;
  classifyClose?(event: CloseEvent): CloudCloseClassification;
}
