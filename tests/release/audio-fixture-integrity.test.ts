import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixturesRoot = path.join(repoRoot, 'tests/fixtures');

function listWavFixtures(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listWavFixtures(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.wav') ? [fullPath] : [];
  });
}

function readUInt32LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function findChunk(buffer: Buffer, chunkName: string): { offset: number; size: number } | null {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const name = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (name === chunkName) {
      return { offset, size };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

describe('audio fixture integrity', () => {
  it('keeps every committed WAV fixture as playable RIFF/WAVE audio', () => {
    const wavFiles = listWavFixtures(fixturesRoot);

    expect(wavFiles.length).toBeGreaterThan(0);

    for (const filePath of wavFiles) {
      const buffer = readFileSync(filePath);
      const relativePath = path.relative(repoRoot, filePath);

      expect(buffer.toString('ascii', 0, 4), `${relativePath} must start with RIFF`).toBe('RIFF');
      expect(buffer.toString('ascii', 8, 12), `${relativePath} must contain WAVE header`).toBe('WAVE');

      const fmtChunk = findChunk(buffer, 'fmt ');
      const dataChunk = findChunk(buffer, 'data');

      expect(fmtChunk, `${relativePath} must contain fmt chunk`).not.toBeNull();
      expect(dataChunk, `${relativePath} must contain data chunk`).not.toBeNull();

      const fmtDataOffset = fmtChunk!.offset + 8;
      const audioFormat = buffer.readUInt16LE(fmtDataOffset);
      const channelCount = buffer.readUInt16LE(fmtDataOffset + 2);
      const sampleRate = readUInt32LE(buffer, fmtDataOffset + 4);
      const byteRate = readUInt32LE(buffer, fmtDataOffset + 8);
      const bitsPerSample = buffer.readUInt16LE(fmtDataOffset + 14);

      expect(audioFormat, `${relativePath} must use PCM format`).toBe(1);
      expect(channelCount, `${relativePath} must have at least one channel`).toBeGreaterThan(0);
      expect(sampleRate, `${relativePath} must have a nonzero sample rate`).toBeGreaterThan(0);
      expect(byteRate, `${relativePath} must have a nonzero byte rate`).toBeGreaterThan(0);
      expect(bitsPerSample, `${relativePath} must have bit depth`).toBeGreaterThan(0);

      const dataSize = dataChunk!.size;
      const durationSeconds = dataSize / byteRate;
      expect(dataSize, `${relativePath} must contain audio data`).toBeGreaterThan(0);
      expect(durationSeconds, `${relativePath} must have nonzero duration`).toBeGreaterThan(0);
      expect(statSync(filePath).size, `${relativePath} should not be an HTML error page`).toBeGreaterThan(44);
    }
  });
});
