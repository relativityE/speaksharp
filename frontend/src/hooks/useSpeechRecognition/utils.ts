import type { Chunk } from './types';

// Pure functions - easily testable
export const combineChunksToText = (chunks: Chunk[]): string =>
  chunks.map(c => c.transcript).join(' ');

export const createFullTranscript = (chunks: Chunk[], interim: string): string =>
  combineChunksToText(chunks) + (interim ? ' ' + interim : '');

export const generateChunkId = (): number =>
  Date.now() + Math.random();

export const createChunk = (transcript: string, speaker?: string): Chunk => ({
  transcript,
  speaker,
  id: generateChunkId(),
  timestamp: Date.now()
});