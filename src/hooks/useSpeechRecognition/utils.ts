import type { Chunk } from './types';

// Pure functions - easily testable
export const combineChunksToText = (chunks: Chunk[]): string =>
  chunks.map(c => c.text).join(' ');

export const createFullTranscript = (chunks: Chunk[], interim: string): string =>
  combineChunksToText(chunks) + (interim ? ' ' + interim : '');

export const generateChunkId = (): number =>
  Date.now() + Math.random();

export const createChunk = (text: string): Chunk => ({
  text,
  id: generateChunkId()
});