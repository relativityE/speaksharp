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

describe('canonical tester guide (tester-facing)', () => {
    const guide = readReleaseDoc('TESTER_GUIDE.md');

    it('does not send testers looking for removed promo-code flows', () => {
        expect(guide).not.toMatch(/promo\s*code|promo-code|redeem/i);
    });

    it('does not offer retired Browser, Cloud, or Private-sample paths', () => {
        expect(guide).not.toMatch(/Browser transcription|Cloud transcription|Private sample/i);
    });

    it('does not use the removed multi-hour trial language', () => {
        expect(guide).not.toMatch(/1 hour of trial access|24 hours of trial access|24-hour Pro trial|60-minute Pro trial/i);
    });

    it('states the free controlled-beta contract', () => {
        expect(guide).toMatch(/controlled beta is free/i);
        expect(guide).toMatch(/No card or checkout is required/i);
    });

    it('sets the on-device Private expectation in plain language', () => {
        expect(guide).toMatch(/Private transcription on your device/i);
        expect(guide).toMatch(/one-time Private model setup/i);
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

    it('keeps Cloud STT framed as paid Pro, out of the free sample path', () => {
        expect(protocol).toMatch(/Cloud STT is a paid Pro feature/i);
        expect(protocol).toMatch(/outside the Free (beta )?path|not part of the beta/i);
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
    // The stable evidence contract + named STT artifacts live in RC_GATES.md (RELEASE_STATUS.md keeps
    // only current run/status posture and links here).
    const readiness = readReleaseDoc('RC_GATES.md');

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

describe('durable paid Early Access product contract (stable invariants)', () => {
    // Protects the stable payment invariants without enforcing the current (temporary) no-billing
    // cohort state corpus-wide. Current toggle state lives in RELEASE_STATUS.md, not the PRD contract.
    const prd = readReleaseDoc('PRD.operational.md');
    const status = readReleaseDoc('RELEASE_STATUS.md');

    it('PRD states SpeakSharp supports paid Early Access as a capability (not a free-forever policy)', () => {
        expect(prd).toMatch(/supports paid Early Access/i);
    });

    it('invariant: paid enrollment requires BOTH payment switches, and key class alone does not open checkout', () => {
        expect(prd).toMatch(/VITE_PAYMENTS_ENABLED/);
        expect(prd).toMatch(/(^|[^_A-Z])PAYMENTS_ENABLED/);
        expect(prd).toMatch(/key class validates configuration but does not by itself open checkout/i);
    });

    it('invariant: existing paid-Pro entitlement remains valid when new enrollment is disabled', () => {
        expect(prd).toMatch(/existing accounts with a valid paid-Pro entitlement retain access/i);
    });

    it('invariant: paid activation and broad public launch are separately authorized', () => {
        expect(prd).toMatch(/separately-authorized step, not the same as broad public launch/i);
        expect(status).toMatch(/Paid public launch/i);
        expect(status).toMatch(/Broad public launch/i);
    });
});
