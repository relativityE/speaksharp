import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (name: string) => readFileSync(resolve(process.cwd(), name), 'utf8')
  .replace(/\*\*/g, '')
  .replace(/\s+/g, ' ');

describe('canonical tester and customer instructions', () => {
  const testerGuide = read('product_release/TESTER_GUIDE.md');
  const userGuide = read('USER_GUIDE.md');
  const authority = read('product_release/ENTITLEMENTS_AND_BILLING.md');

  it('states one complete Private-only product with Open Mic and optional Focus Points', () => {
    for (const doc of [testerGuide, userGuide, authority]) {
      expect(doc).toMatch(/Open Mic/i);
      expect(doc).toMatch(/Focus Points/i);
      expect(doc).toMatch(/Private/i);
    }
    expect(testerGuide).toMatch(/Every customer practice session uses Private transcription on your device/i);
    expect(userGuide).toMatch(/audio is not sent to a transcription provider/i);
  });

  it('states the complete 30-day product then the same product for $10/month', () => {
    for (const doc of [testerGuide, userGuide, authority]) {
      expect(doc).toMatch(/free for 30 days/i);
      expect(doc).toMatch(/\$10\/month/i);
    }
  });

  it('retains only the ten-minute per-recording technical cap', () => {
    expect(userGuide).toMatch(/ten-minute technical cap/i);
    expect(authority).toMatch(/ten-minute technical cap/i);
    expect(authority).toMatch(/no accumulated daily or monthly recording-minute gate/i);
  });

  it('keeps payment activation fail-closed and separate', () => {
    expect(userGuide).toMatch(/Payments remain unavailable until SpeakSharp separately activates/i);
    expect(authority).toMatch(/separately authorized/i);
    expect(authority).toMatch(/No source document authorizes a live charge/i);
  });

  it('keeps tester feedback plain-language and actionable', () => {
    // #1404: the control is named "Share Feedback". This lock previously pinned the OLD name, so the
    // guide stayed green while instructing testers four times to click a button that no longer exists.
    // A guide that names a missing control is the failure this test is for, so the lock moves with it.
    expect(testerGuide).toMatch(/Share Feedback/i);
    expect(testerGuide, 'no stale control name may survive in active tester guidance').not.toMatch(/Report Issue/i);
    expect(testerGuide).toMatch(/confusing, broken, slow, inaccurate, or surprising/i);

    // #1408 — Share Feedback carries praise, suggestions and questions as well as defects, so the SHARED
    // guidance may not frame every message as a defect report. These two regressed once already: the
    // guide still called a submission a "report" and asked every sender what they expected and what
    // happened, which is meaningless for a compliment.
    expect(testerGuide, 'a submission is a message, not a report')
        .not.toMatch(/submitted the report|submit(ting)? a report|your report\b/i);
    // Expected-vs-actual may appear ONLY as an optional Issue clause, never as the shared instruction.
    // Scoped by SENTENCE: the qualifier ("For an Issue, ...") precedes the clause, so a match starting at
    // "what you expected" would never contain it — the first version of this check failed for that reason.
    const sentences = testerGuide.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences.filter((s) => /what you expected/i.test(s))) {
        expect(sentence.trim(), `expected-vs-actual must be scoped to an Issue: "${sentence.trim()}"`)
            .toMatch(/For an Issue/i);
    }
    // The shared instruction must name the non-defect cases explicitly.
    expect(testerGuide).toMatch(/suggestion/i);
    expect(testerGuide).toMatch(/question/i);
    expect(testerGuide).toMatch(/worked well/i);
    expect(testerGuide).not.toMatch(/VITE_|127\.0\.0\.1|PostHog|WebGPU|live-release-matrix|effective_subscription_tier/i);
  });
});
