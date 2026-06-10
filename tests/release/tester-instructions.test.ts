import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readReleaseDoc = (name: string) =>
    readFileSync(resolve(process.cwd(), 'product_release', name), 'utf8');

describe('soft release tester instructions', () => {
    it('do not send testers looking for removed promo-code flows', () => {
        const instructions = readReleaseDoc('SOFT_RELEASE_TESTER_INSTRUCTIONS.md');

        expect(instructions).not.toMatch(/promo\s*code|promo-code|redeem/i);
    });

    it('keeps Cloud STT out of the free-account sample tester task list', () => {
        const instructions = readReleaseDoc('SOFT_RELEASE_TESTER_INSTRUCTIONS.md');

        expect(instructions).toMatch(/Cloud STT is a paid Early Access feature/i);
        expect(instructions).not.toMatch(/optionally try cloud/i);
    });

    it('matches the current database-backed Private sample duration', () => {
        const instructions = readReleaseDoc('SOFT_RELEASE_TESTER_INSTRUCTIONS.md');

        expect(instructions).toMatch(/one short Private transcription sample/i);
        expect(instructions).not.toMatch(/1 hour of trial access|24 hours of trial access|24-hour Pro trial|60-minute Pro trial/i);
    });

    it('sets Private first-text expectations before testers record', () => {
        const instructions = readReleaseDoc('SOFT_RELEASE_TESTER_INSTRUCTIONS.md');

        expect(instructions).toMatch(/runs on your device/i);
        expect(instructions).toMatch(/first words can take about 5 seconds to appear/i);
    });

    it('explicitly covers the current human tester protocol', () => {
        const instructions = readReleaseDoc('SOFT_RELEASE_TESTER_INSTRUCTIONS.md');

        expect(instructions).toMatch(/Set Up|Download Private Model/i);
        expect(instructions).toMatch(/Export a PDF/i);
        expect(instructions).toMatch(/Custom Words/i);
        expect(instructions).toMatch(/saved analytics\/session detail/i);
        expect(instructions).toMatch(/Browser transcription uses your browser's built-in speech recognition/i);
        expect(instructions).toMatch(/Chrome is recommended/i);
        expect(instructions).toMatch(/Do not claim Edge support unless an Edge-specific proof has passed/i);
    });
});

describe('release candidate gate evidence contract', () => {
    it('requires latest complete passing artifacts, not stale passing evidence', () => {
        const readiness = readReleaseDoc('RELEASE_STATUS.md');

        expect(readiness).toMatch(/latest complete passing run/i);
        expect(readiness).toMatch(/newer run fails any required criterion/i);
        expect(readiness).toMatch(/parent gate returns to red/i);
        expect(readiness).toMatch(/Last updated by: \[initials\] \[date\] \[artifact path\]/i);
    });

    it('folds the STT binary gates into their parent RC gates with named artifacts', () => {
        const readiness = readReleaseDoc('RELEASE_STATUS.md');

        expect(readiness).toMatch(/Private sample recording/i);
        expect(readiness).toMatch(/SESSION_LIFECYCLE_WARMUP/i);
        expect(readiness).toMatch(/speaksharp-private-human-\[timestamp\]\.json/i);
        expect(readiness).toMatch(/onspeechstart -> first onresult/i);
        expect(readiness).toMatch(/4-word sequence appearing more than once/i);
        expect(readiness).toMatch(/speaksharp-native-\[timestamp\]\.json/i);
        expect(readiness).toMatch(/AssemblyAI token HTTP 200/i);
        expect(readiness).toMatch(/cloud-artifact-\[timestamp\]\.log/i);
        expect(readiness).toMatch(/like = 1/i);
        expect(readiness).toMatch(/basically = 1/i);
        expect(readiness).toMatch(/within ±15%/i);
        expect(readiness).toMatch(/Session Status UX/i);
    });
});
