import * as dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences.js';
import { calculateWordErrorRate } from '../frontend/src/lib/wer.js';

dotenv.config();

type Variant = 'baseline' | 'keyterms' | 'prompt' | 'prompt_keyterms';

type WavPcm = {
  sampleRate: number;
  pcmBytes: Uint8Array;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.resolve(__dirname, '../tests/fixtures/stt-isomorphic/audio');
const OUT = process.env.ASSEMBLYAI_STREAMING_AB_OUT ||
  `/private/tmp/speaksharp-cloud-assemblyai-streaming-ab-${Date.now()}.json`;
const FIXTURES = (process.env.ASSEMBLYAI_STREAMING_AB_FIXTURES || HARVARD_SENTENCES.map((sentence) => sentence.id).join(','))
  .split(',')
  .map((fixture) => fixture.trim())
  .filter(Boolean);
const VARIANTS = (process.env.ASSEMBLYAI_STREAMING_AB_VARIANTS || 'baseline,keyterms,prompt,prompt_keyterms')
  .split(',')
  .map((variant) => variant.trim())
  .filter(Boolean) as Variant[];
const SAMPLE_RATE_HZ = 16_000;
const ENCODING = 'pcm_s16le';
const SPEECH_MODEL = 'universal-streaming-english';
const CHUNK_MS = Number(process.env.ASSEMBLYAI_STREAMING_AB_CHUNK_MS || 50);
const SOCKET_TIMEOUT_MS = Number(process.env.ASSEMBLYAI_STREAMING_AB_TIMEOUT_MS || 30_000);
const apiKey = process.env.ASSEMBLYAI_API_KEY;

const FILLER_TERMS = [
  'um',
  'uh',
  'like',
  'basically',
  'well',
  'you know',
  'literally',
].map((term) => term.toLowerCase());

const DEFAULT_KEYTERMS = [
  'um',
  'uh',
  'like',
  'basically',
  'well',
  'you know',
  'literally',
  'actually',
  'so',
  'right',
  'i mean',
  'umm',
  'ummm',
  'uhm',
  'uhh',
  'uhhh',
  'er',
  'err',
  'ahm',
  "y'know",
  'ya know',
  'kinda',
  'sorta',
] as const;

function compact(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function normalize(text: string): string {
  return compact(text)
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countTerm(text: string, term: string): number {
  const normalizedText = ` ${normalize(text)} `;
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return 0;
  const pattern = new RegExp(`\\b${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return [...normalizedText.matchAll(pattern)].length;
}

function fillerRecall(reference: string, hypothesis: string): number | null {
  const expected = FILLER_TERMS.reduce((sum, term) => sum + countTerm(reference, term), 0);
  if (expected === 0) return null;
  const observed = FILLER_TERMS.reduce((sum, term) => sum + Math.min(countTerm(reference, term), countTerm(hypothesis, term)), 0);
  return observed / expected;
}

function buildKeyterms(userWords: string[] = []): string[] {
  const seen = new Set<string>();
  return [...DEFAULT_KEYTERMS, ...userWords]
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

function buildPrompt(keyterms: string[]): string {
  const highlightedTerms = keyterms.slice(0, 30).join(', ');
  return [
    'Transcribe verbatim for speech coaching.',
    'Preserve filler words, repetitions, self-corrections, and disfluencies when spoken.',
    highlightedTerms ? `Pay special attention to these coaching terms: ${highlightedTerms}.` : '',
  ].filter(Boolean).join(' ');
}

function parsePcm16Wav(buffer: Buffer): WavPcm {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected RIFF/WAVE audio fixture');
  }

  let offset = 12;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let channels = 0;
  let data: Uint8Array | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    if (chunkId === 'fmt ') {
      const audioFormat = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
      if (audioFormat !== 1) throw new Error(`Expected PCM wav, got format ${audioFormat}`);
    } else if (chunkId === 'data') {
      data = new Uint8Array(buffer.subarray(chunkStart, chunkEnd));
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!data) throw new Error('WAV data chunk not found');
  if (channels !== 1) throw new Error(`Expected mono WAV, got ${channels} channels`);
  if (bitsPerSample !== 16) throw new Error(`Expected 16-bit WAV, got ${bitsPerSample}`);
  if (sampleRate !== SAMPLE_RATE_HZ) {
    throw new Error(`Expected ${SAMPLE_RATE_HZ}Hz WAV, got ${sampleRate}Hz`);
  }

  return { sampleRate, pcmBytes: data };
}

async function createStreamingToken(): Promise<string> {
  if (!apiKey) {
    throw new Error('ASSEMBLYAI_API_KEY is required for AssemblyAI streaming A/B proof.');
  }

  const response = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=600', {
    method: 'GET',
    headers: { Authorization: apiKey },
  });
  if (!response.ok) {
    throw new Error(`AssemblyAI token request failed: ${response.status} ${await response.text()}`);
  }
  const body = await response.json() as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token) {
    throw new Error('AssemblyAI token response did not include token');
  }
  return body.token;
}

function buildUrl(variant: Variant, token: string): string {
  const keyterms = buildKeyterms([]);
  const params = new URLSearchParams({
    sample_rate: String(SAMPLE_RATE_HZ),
    encoding: ENCODING,
    speech_model: SPEECH_MODEL,
    format_turns: 'true',
    token,
  });

  if (variant === 'keyterms' || variant === 'prompt_keyterms') {
    params.set('keyterms_prompt', JSON.stringify(keyterms));
  }
  if (variant === 'prompt' || variant === 'prompt_keyterms') {
    params.set('prompt', buildPrompt(keyterms));
  }

  return `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
}

async function transcribeStreaming(variant: Variant, fixtureId: string): Promise<{
  transcript: string;
  turns: Array<{ type: string; end_of_turn?: boolean; transcript?: string; text?: string }>;
  terminationSeen: boolean;
}> {
  const audioPath = path.join(AUDIO_DIR, `${fixtureId}.wav`);
  const wav = parsePcm16Wav(await fs.readFile(audioPath));
  const token = await createStreamingToken();
  const turns: Array<{ type: string; end_of_turn?: boolean; transcript?: string; text?: string }> = [];
  const finals: string[] = [];
  let latestPartial = '';
  let terminationSeen = false;

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(buildUrl(variant, token));
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error(`AssemblyAI streaming timeout for ${fixtureId} (${variant})`));
    }, SOCKET_TIMEOUT_MS);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };

    ws.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`AssemblyAI WebSocket error for ${fixtureId} (${variant})`));
    });

    ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) return;
      const message = JSON.parse(raw) as { type?: string; end_of_turn?: boolean; transcript?: string; text?: string };
      turns.push({
        type: message.type ?? 'unknown',
        end_of_turn: message.end_of_turn,
        transcript: message.transcript,
        text: message.text,
      });
      if (message.type === 'Turn') {
        const turnText = compact(message.transcript || message.text || '');
        if (message.end_of_turn) {
          if (turnText) finals.push(turnText);
          latestPartial = '';
        } else {
          latestPartial = turnText || latestPartial;
        }
      }
      if (message.type === 'Termination') {
        terminationSeen = true;
        finish();
      }
    });

    ws.addEventListener('open', () => {
      const bytesPerChunk = Math.max(2, Math.round((wav.sampleRate * CHUNK_MS) / 1000) * 2);
      let offset = 0;
      const sendNext = () => {
        if (offset >= wav.pcmBytes.byteLength) {
          ws.send(JSON.stringify({ type: 'Terminate' }));
          return;
        }
        const chunk = wav.pcmBytes.slice(offset, Math.min(offset + bytesPerChunk, wav.pcmBytes.byteLength));
        ws.send(chunk);
        offset += chunk.byteLength;
        setTimeout(sendNext, CHUNK_MS);
      };
      sendNext();
    });

    ws.addEventListener('close', () => finish());
  });

  return {
    transcript: compact([...finals, latestPartial].join(' ')),
    turns,
    terminationSeen,
  };
}

const fixtures = HARVARD_SENTENCES.filter((sentence) => FIXTURES.includes(sentence.id));
const evidence = {
  startedAt: new Date().toISOString(),
  model: SPEECH_MODEL,
  chunkMs: CHUNK_MS,
  variants: VARIANTS,
  fixtures: fixtures.map((fixture) => fixture.id),
  results: [] as Array<Record<string, unknown>>,
};

for (const variant of VARIANTS) {
  for (const fixture of fixtures) {
    try {
      const result = await transcribeStreaming(variant, fixture.id);
      const wer = calculateWordErrorRate(fixture.transcript, result.transcript);
      const row = {
        variant,
        fixture: fixture.id,
        truth: fixture.transcript,
        transcript: result.transcript,
        wer,
        accuracyPct: Number(((1 - wer) * 100).toFixed(2)),
        fillerRecall: fillerRecall(fixture.transcript, result.transcript),
        turnCount: result.turns.length,
        finalTurnCount: result.turns.filter((turn) => turn.type === 'Turn' && turn.end_of_turn).length,
        partialTurnCount: result.turns.filter((turn) => turn.type === 'Turn' && !turn.end_of_turn).length,
        terminationSeen: result.terminationSeen,
      };
      evidence.results.push(row);
      console.log(`ASSEMBLYAI_STREAMING_AB_ROW ${JSON.stringify(row)}`);
    } catch (error) {
      const row = {
        variant,
        fixture: fixture.id,
        error: error instanceof Error ? error.message : String(error),
      };
      evidence.results.push(row);
      console.error(`ASSEMBLYAI_STREAMING_AB_ROW ${JSON.stringify(row)}`);
    }
  }
}

const variantSummaries = VARIANTS.map((variant) => {
  const rows = evidence.results.filter((row) => row.variant === variant && typeof row.wer === 'number');
  const averageWer = rows.length
    ? rows.reduce((sum, row) => sum + (row.wer as number), 0) / rows.length
    : null;
  const fillerRows = rows.filter((row) => typeof row.fillerRecall === 'number');
  const averageFillerRecall = fillerRows.length
    ? fillerRows.reduce((sum, row) => sum + (row.fillerRecall as number), 0) / fillerRows.length
    : null;
  return {
    variant,
    rowCount: rows.length,
    averageWer,
    averageAccuracyPct: averageWer == null ? null : Number(((1 - averageWer) * 100).toFixed(2)),
    averageFillerRecall,
  };
});

const finalEvidence = {
  ...evidence,
  finishedAt: new Date().toISOString(),
  variantSummaries,
};

await fs.writeFile(OUT, JSON.stringify(finalEvidence, null, 2));
console.log(`ASSEMBLYAI_STREAMING_AB_EVIDENCE ${JSON.stringify({ out: OUT, variantSummaries })}`);
