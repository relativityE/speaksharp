#!/usr/bin/env node
/**
 * Work point 2: build the long-form real-speech clips for the STT reliability corpus and write the frozen
 * manifest that binds each reference to the exact audio that will be played.
 *
 * Source: LibriSpeech test-clean (OpenSLR SLR12, CC BY 4.0). The archive must already have passed the
 * pinned verification in verify-archive.mjs (byte count, the publisher's MD5, our SHA-256) via
 * fetch-librispeech.sh. This script re-checks the pin before reading a single file.
 *
 * Construction rules (release review, work point 2):
 *   - Each clip is CONTIGUOUS utterances of ONE chapter, in the chapter's own order. It is never a collage
 *     of speakers.
 *   - Each FLAC is decoded losslessly to 16 kHz mono s16le, and the PCM is joined exactly. There is no
 *     resampling (LibriSpeech is 16 kHz mono), no inserted gap, no wrapping and no cropping. The clip's
 *     sample count equals the sum of its utterances' sample counts, and that is checked.
 *   - The reference is the utterances' transcripts in the same order.
 *   - The manifest records the WAV SHA-256, sample rate, sample count and duration; the reference and its
 *     SHA-256; and each source utterance with its sample count.
 *   - Each clip stays within the 600 s maximum take, with a margin for Start/Stop.
 *
 * A controlled concatenation of read audiobook speech is file-fed corpus evidence. It does not substitute
 * for a device observation or for conversational speech.
 *
 * Usage: node scripts/corpus/make-reliability-corpus.mjs <bench-corpus dir> <output dir>
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArchive } from './verify-archive.mjs';

export const SAMPLE_RATE_HZ = 16_000;
export const MAX_TAKE_SECONDS = 600;

/**
 * Planned long-form clips: an upper bound, and a minimum share of it that the clip must reach. They are
 * allocated LONGEST FIRST, so a long chapter is never used up by a shorter target.
 */
export const LONG_FORM_TARGETS = Object.freeze([
    { id: 'rel-10m', maxSeconds: 590, minSeconds: 540 },
    { id: 'rel-05m', maxSeconds: 300, minSeconds: 270 },
    { id: 'rel-02m', maxSeconds: 120, minSeconds: 108 },
]);

/** Chapters already in the committed corpus. long-01 is cut from this one, so reusing it would score the same speech twice. */
export const RESERVED_CHAPTERS = Object.freeze(['1089/134686']);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Lossless FLAC → 16 kHz mono s16le PCM. It refuses any input that is not already 16 kHz, mono and 16-bit, and
 * checks the decoded sample count against the stream's own count (ffprobe duration_ts, from the FLAC STREAMINFO).
 * That is an independent source, so a decode that drops or pads samples is caught.
 */
export function decodeFlacToPcm(flacPath) {
    // Parsed by key: ffprobe prints stream fields in its own order, not the order they were requested.
    const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=sample_rate,channels,bits_per_raw_sample,duration_ts', '-of', 'default=noprint_wrappers=1', flacPath],
    { encoding: 'utf8' });
    const field = Object.fromEntries(probe.trim().split('\n').map(line => line.split('=')));
    const declaredSamples = field.duration_ts;
    if (field.sample_rate !== String(SAMPLE_RATE_HZ) || field.channels !== '1' || field.bits_per_raw_sample !== '16'
        || !/^\d+$/.test(declaredSamples ?? '')) {
        throw new Error(`NOT 16 kHz mono 16-bit with a declared length (${probe.trim().replace(/\n/g, ' ')}): ${flacPath}`);
    }
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', flacPath, '-f', 's16le', '-acodec', 'pcm_s16le', '-'],
        { maxBuffer: 256 * 1024 * 1024 });
    if (pcm.length !== Number(declaredSamples) * 2) {
        throw new Error(`decoded ${pcm.length / 2} samples but the stream declares ${declaredSamples}: ${flacPath}`);
    }
    return pcm;
}

export function wavFromPcm(pcm) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
    header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE_HZ, 24); header.writeUInt32LE(SAMPLE_RATE_HZ * 2, 28);
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

function chapters(setDir) {
    return readdirSync(setDir).sort().flatMap(speaker => readdirSync(join(setDir, speaker)).sort()
        .map(chapter => join(setDir, speaker, chapter)));
}

function chapterUtterances(chapterDir) {
    const trans = readdirSync(chapterDir).find(name => name.endsWith('.trans.txt'));
    if (!trans) throw new Error(`no transcript in ${chapterDir}`);
    return readFileSync(join(chapterDir, trans), 'utf8').split('\n').filter(Boolean).map(line => {
        const space = line.indexOf(' ');
        return { id: line.slice(0, space), reference: line.slice(space + 1), flac: join(chapterDir, `${line.slice(0, space)}.flac`) };
    }).sort((a, b) => a.id.localeCompare(b.id));
}

/** Build one clip from a chapter's contiguous utterances, starting at its first, up to maxSeconds. */
export function buildFromChapter(chapterDir, maxSeconds) {
    const parts = [];
    let samples = 0;
    for (const utt of chapterUtterances(chapterDir)) {
        const pcm = decodeFlacToPcm(utt.flac);
        const uttSamples = pcm.length / 2;
        if ((samples + uttSamples) / SAMPLE_RATE_HZ > maxSeconds) break;
        parts.push({ ...utt, pcm, sampleCount: uttSamples, flacSha256: sha256(readFileSync(utt.flac)) });
        samples += uttSamples;
    }
    return { parts, sampleCount: samples };
}

export function clipRecord(id, wavRelativePath, wav, parts, corpusRoot) {
    const sampleCount = (wav.length - 44) / 2;
    const summed = parts.reduce((sum, p) => sum + p.sampleCount, 0);
    if (sampleCount !== summed) throw new Error(`${id}: sample count ${sampleCount} != utterance sum ${summed}`);
    const reference = parts.map(p => p.reference).join(' ');
    return {
        id, kind: 'speech', reference, referenceSha256: sha256(reference),
        audio: {
            // The PCM digest is the played-audio identity: file digests also cover header bytes that differ
            // between WAV writers (the committed long-01.wav carries an extra ffmpeg header chunk; its PCM is identical).
            path: wavRelativePath, fileSha256: sha256(wav), pcmSha256: sha256(wav.subarray(44)), sampleRateHz: SAMPLE_RATE_HZ, sampleCount,
            durationSeconds: sampleCount / SAMPLE_RATE_HZ,
        },
        source: {
            chapter: relative(corpusRoot, join(parts[0].flac, '..')),
            // Each source FLAC's digest binds the clip to the files actually read from the extracted tree.
            utterances: parts.map(p => ({ id: p.id, sampleCount: p.sampleCount, flacSha256: p.flacSha256 })),
        },
    };
}

async function main([corpusArg, outArg]) {
    const corpusRoot = resolve(corpusArg ?? 'bench-corpus');
    const outDir = resolve(outArg ?? 'bench-corpus/reliability');
    const archive = join(corpusRoot, 'test-clean.tar.gz');
    const verdict = await verifyArchive({ path: archive, name: 'test-clean.tar.gz', mode: 'pinned' });
    if (!verdict.ok || !verdict.pinnedSha256Checked) throw new Error(`test-clean.tar.gz failed pinned verification: ${verdict.reason ?? 'pin not checked'}`);
    const setDir = join(corpusRoot, 'LibriSpeech', 'test-clean');
    if (!existsSync(setDir)) throw new Error(`${setDir} missing: run fetch-librispeech.sh first`);
    mkdirSync(outDir, { recursive: true });

    const clips = [];
    const used = new Set(RESERVED_CHAPTERS.map(chapter => join(setDir, chapter)));
    for (const target of LONG_FORM_TARGETS) {
        // The first chapter, in sorted order, not already used, that can reach the target: deterministic, never "any".
        let built = null;
        let longEnoughButUsed = 0;
        for (const chapterDir of chapters(setDir)) {
            const candidate = buildFromChapter(chapterDir, target.maxSeconds);
            if (candidate.sampleCount / SAMPLE_RATE_HZ < target.minSeconds) continue;
            if (used.has(chapterDir)) { longEnoughButUsed++; continue; }
            built = { chapterDir, ...candidate };
            break;
        }
        if (!built) {
            // Recorded, never dropped: a planned clip that could not be built honestly stays in the manifest, with
            // the true reason.
            clips.push({ id: target.id, kind: 'speech', status: 'NOT_BUILT',
                reason: longEnoughButUsed > 0
                    ? `the ${longEnoughButUsed} test-clean chapter(s) reaching ${target.minSeconds} s are already used`
                    : `no single test-clean chapter reaches ${target.minSeconds} s; a labelled same-speaker, same-book `
                        + 'multi-chapter join needs a release-review decision on its source' });
            continue;
        }
        used.add(built.chapterDir);
        const wav = wavFromPcm(Buffer.concat(built.parts.map(p => p.pcm)));
        writeFileSync(join(outDir, `${target.id}.wav`), wav);
        clips.push({ status: 'BUILT', ...clipRecord(target.id, `${target.id}.wav`, wav, built.parts, corpusRoot) });
    }
    const manifest = {
        version: 'stt_reliability_corpus_v1',
        licence: 'CC BY 4.0',
        attribution: 'LibriSpeech ASR corpus, Panayotov et al., ICASSP 2015. https://www.openslr.org/12/',
        archive: { name: 'test-clean.tar.gz', bytes: verdict.bytes, officialMd5: verdict.md5, sha256: verdict.sha256 },
        construction: 'contiguous utterances of one chapter, lossless 16 kHz mono PCM joined exactly; no gap, wrap or crop',
        limitation: 'file-fed read speech; not device observation and not conversational speech',
        clips,
    };
    writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const c of clips) {
        console.log(c.status === 'BUILT'
            ? `${c.id}  ${c.audio.durationSeconds.toFixed(2)} s  ${c.source.utterances.length} utterances  ${c.source.chapter}  pcm ${c.audio.pcmSha256}`
            : `${c.id}  NOT BUILT: ${c.reason}`);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch(error => { console.error(`FATAL: ${error.message}`); process.exit(1); });
}
