import type { Chunk } from './types';

export const sentenceCaseStart = (text: string): string => {
  const firstLetterIndex = text.search(/[A-Za-z]/);
  if (firstLetterIndex === -1) return text;
  return `${text.slice(0, firstLetterIndex)}${text.charAt(firstLetterIndex).toUpperCase()}${text.slice(firstLetterIndex + 1)}`;
};

// Pure functions - easily testable
export const combineChunksToText = (chunks: Chunk[]): string =>
  sentenceCaseStart(chunks.map(c => c.transcript).join(' '));

export const createFullTranscript = (chunks: Chunk[], interim: string): string =>
  sentenceCaseStart(combineChunksToText(chunks) + (interim ? ' ' + interim : ''));

export const generateChunkId = (): number =>
  Date.now() + Math.random();

export const createChunk = (transcript: string, speaker?: string): Chunk => ({
  transcript: sentenceCaseStart(transcript),
  speaker,
  id: generateChunkId(),
  timestamp: Date.now()
});
