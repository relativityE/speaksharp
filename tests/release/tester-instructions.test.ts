import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Normalize markdown formatting so these content guards assert wording/invariants,
// not layout: strip bold markers and collapse line-wrapped whitespace.
const readReleaseDoc = (name: string) =>
    readFileSync(resolve(process.cwd(), 'product_release', name), 'utf8')
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ');

// The soft-release tester doc was split (2026-06-26):
//   - SOFT_RELEASE_TESTER_INSTRUCTIONS.md = plain-language, tester-facing guide.
//   - INTERNAL_TEST_PROTOCOL.md           = operator/dev/test protocol.
// Tester-facing invariants are asserted on the guide; operator/technical
// invariants are asserted on the protocol.

describe('soft release tester guide (tester-facing)', () => {
    const guide = readReleaseDoc('SOFT_RELEASE_TESTER_INSTRUCTIONS.md');

    it('does not send testers looking for removed promo-code flows', () => {
        expect(guide).not.toMatch(/promo\s*code|promo-code|redeem/i);
    });

    it('does not promise paid Cloud STT in the free tester path', () => {
        expect(guide).not.toMatch(/cloud stt|free cloud|optionally try cloud/i);
    });

    it('does not use the removed multi-hour trial language', () => {
        expect(guide).not.toMatch(/1 hour of trial access|24 hours of trial access|24-hour Pro trial|60-minute Pro trial/i);
    });

    it('states the one 5-minute Private sample and that it does not count down from signup', () => {
        expect(guide).toMatch(/one Private sample of up to 5\s*minutes/i);
        expect(guide).toMatch(/does\s+not\s+start\s+counting\s+down/i);
    });

    it('sets the on-device Private expectation in plain language', () => {
        expect(guide).toMatch(/runs (entirely )?on your own device/i);
        expect(guide).toMatch(/few seconds to get ready/i);
    });

    it('points testers to Report Issue for anything confusing, broken, slow, or surprising', () => {
        expect(guide).toMatch(/Report Issue/i);
        expect(guide).toMatch(/confusing, broken, slow, inaccurate, or surprising/i);
    });

    it('stays jargon-free (no developer/internal terms leak to testers)', () => {
        expect(guide).not.toMatch(/VITE_|127\.0\.0\.1|PostHog|WebGPU|stripeKeyClass|live-release-matrix|feature flag|effective_subscription_tier/i);
    });
});

describe('internal test protocol (operator/dev/test)', () => {
    const protocol = readReleaseDoc('INTERNAL_TEST_PROTOCOL.md');

    it('keeps Cloud STT framed as paid, out of the free sample path', () => {
        expect(protocol).toMatch(/Cloud STT is a paid Early Access feature/i);
    });

    it('matches the current database-backed Private sample (not old trial grants)', () => {
        expect(protocol).toMatch(/Private sample/i);
        expect(protocol).toMatch(/private_sample_limit_seconds/i);
        expect(protocol).not.toMatch(/1 hour of trial access|24 hours of trial access|24-hour Pro trial|60-minute Pro trial/i);
    });

    it('preserves the per-tester acceptance criteria', () => {
        expect(protocol).toMatch(/PDF export/i);
        expect(protocol).toMatch(/custom word/i);
        expect(protocol).toMatch(/saved analytics\/session detail/i);
    });

    it('keeps the browser-support wording guard', () => {
        expect(protocol).toMatch(/built-in speech recognition/i);
        expect(protocol).toMatch(/Chrome is recommended/i);
        expect(protocol).toMatch(/Do not claim Edge support unless an Edge-specific proof has passed/i);
    });

    it('keeps the environment safety rules', () => {
        expect(protocol).toMatch(/127\.0\.0\.1:5173/);
        expect(protocol).toMatch(/VITE_TEST_MODE/);
    });
});

describe('release candidate gate evidence contract', () => {
    const readiness = readReleaseDoc('RELEASE_STATUS.md');

    it('requires latest complete passing artifacts, not stale passing evidence', () => {
        expect(readiness).toMatch(/latest complete passing run/i);
        expect(readiness).toMatch(/newer run fails any required criterion/i);
        expect(readiness).toMatch(/parent gate returns to red/i);
        expect(readiness).toMatch(/Last updated by: \[initials\] \[date\] \[artifact path\]/i);
    });

    it('folds the STT binary gates into their parent RC gates with named artifacts', () => {
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
