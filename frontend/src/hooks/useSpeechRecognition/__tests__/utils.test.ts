import { describe, it, expect } from 'vitest';
import { combineChunksToText, createFullTranscript, createChunk, generateChunkId } from '../utils';
import type { Chunk } from '../types';

describe('useSpeechRecognition utils', () => {
  const mockChunks: Chunk[] = [
    { text: 'Hello', id: 1, timestamp: 1000 },
    { text: 'world', id: 2, timestamp: 2000 }
  ];

  describe('combineChunksToText', () => {
    it('should combine chunks into single text', () => {
      expect(combineChunksToText(mockChunks)).toBe('Hello world');
    });

    it('should return empty string for empty chunks', () => {
      expect(combineChunksToText([])).toBe('');
    });
  });

  describe('createFullTranscript', () => {
    it('should combine chunks and interim text', () => {
      expect(createFullTranscript(mockChunks, 'test')).toBe('Hello world test');
    });

    it('should handle empty interim text', () => {
      expect(createFullTranscript(mockChunks, '')).toBe('Hello world');
    });
  });

  describe('createChunk', () => {
    it('should create chunk with text and unique id', () => {
      const chunk = createChunk('test');
      expect(chunk.text).toBe('test');
      expect(typeof chunk.id).toBe('number');
    });
  });

  describe('generateChunkId', () => {
    it('should generate unique ids', () => {
      const id1 = generateChunkId();
      const id2 = generateChunkId();
      expect(id1).not.toBe(id2);
    });
  });
});