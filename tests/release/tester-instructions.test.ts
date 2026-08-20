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
    expect(testerGuide).toMatch(/Report Issue/i);
    expect(testerGuide).toMatch(/confusing, broken, slow, inaccurate, or surprising/i);
    expect(testerGuide).not.toMatch(/VITE_|127\.0\.0\.1|PostHog|WebGPU|live-release-matrix|effective_subscription_tier/i);
  });
});
