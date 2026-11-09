/** Types for make-reliability-corpus.mjs, which stays plain ESM because it is run directly with node. */
export const SAMPLE_RATE_HZ: 16000;
export const MAX_TAKE_SECONDS: 600;
export const LONG_FORM_TARGETS: readonly { id: string; maxSeconds: number; minSeconds: number }[];
export const RESERVED_CHAPTERS: readonly string[];
export interface BuiltPart { id: string; reference: string; flac: string; pcm: Buffer; sampleCount: number; flacSha256: string }
export function decodeFlacToPcm(flacPath: string): Buffer;
export function wavFromPcm(pcm: Buffer): Buffer;
export function buildFromChapter(chapterDir: string, maxSeconds: number): { parts: BuiltPart[]; sampleCount: number };
export function clipRecord(id: string, wavRelativePath: string, wav: Buffer, parts: readonly BuiltPart[], corpusRoot: string): {
    id: string; kind: 'speech'; reference: string; referenceSha256: string;
    audio: { path: string; fileSha256: string; pcmSha256: string; sampleRateHz: number; sampleCount: number; durationSeconds: number };
    source: { chapter: string; utterances: { id: string; sampleCount: number; flacSha256: string }[] };
};
