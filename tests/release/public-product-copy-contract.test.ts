import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const surfaces = {
  signup: read('frontend/src/pages/AuthPage.tsx'),
  practice: read('frontend/src/pages/PracticePage.tsx'),
  pricing: read('frontend/src/pages/PricingPage.tsx'),
  analytics: read('frontend/src/pages/AnalyticsPage.tsx'),
  legal: read('frontend/src/pages/LegalPage.tsx'),
  testerGuide: read('product_release/TESTER_GUIDE.md'),
  browserWarning: read('frontend/src/components/BrowserWarning.tsx'),
  session: read('frontend/src/pages/SessionPage.tsx'),
  recorder: read('frontend/src/components/session/LiveRecordingCard.tsx'),
  browserSupport: read('frontend/src/hooks/useBrowserSupport.ts'),
  sessionLifecycle: read('frontend/src/hooks/useSessionLifecycle.ts'),
  speechRecognition: read('frontend/src/hooks/useSpeechRecognition/useSpeechRecognition_prod.ts'),
  finalizedAnalysis: read('frontend/src/utils/finalizedSessionAnalysis.ts'),
  privateWindow: read('frontend/src/utils/privateSampleDuration.ts'),
  upgradePrompt: read('frontend/src/components/UpgradePromptDialog.tsx'),
  statusNotification: read('frontend/src/components/session/StatusNotificationBar.tsx'),
  transcriptPanel: read('frontend/src/components/session/LiveTranscriptPanel.tsx'),
  faq: read('frontend/src/content/faqSections.ts'),
};

const stringLiterals = (source: string) =>
  [...source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? '');

const customerSourceFiles = [
  'frontend/src/pages',
  'frontend/src/components',
  'frontend/src/content',
].flatMap((directory) => readdirSync(resolve(process.cwd(), directory), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) && !entry.parentPath.includes('__tests__'))
  .map((entry) => resolve(entry.parentPath, entry.name)));

const customerCopy = customerSourceFiles
  .flatMap((path) => stringLiterals(readFileSync(path, 'utf8')))
  .join('\n');

describe('Private-only public product copy contract (#1254)', () => {
  it('locks the exact product truth on every customer surface', () => {
    // #1266 commercial model: ONE product, free for 30 days, then $10/month Pro. No permanent Free tier,
    // no $9.99, no feature-tiered Private, no invented fair-use numbers.
    expect(surfaces.signup).toContain('Free for 30 days — no card required');
    expect(surfaces.signup).toContain('continue for $10/month');
    expect(surfaces.signup).toContain('paid continuation ($10/month) opens when Pro enrollment is enabled');
    expect(surfaces.practice).toContain('See which points were detected — and what to retry');
    expect(surfaces.pricing).toContain('One product. Free for 30 days.');
    expect(surfaces.pricing).toContain('The complete Private Practice product is free for your first 30 days');
    expect(surfaces.pricing).toContain('$10');
    expect(surfaces.analytics).toContain('is free for 30 days, then $10/month to continue');
    expect(surfaces.upgradePrompt).toContain('Continue for $10/month to keep going after it ends');
    expect(surfaces.legal).toContain('Every customer recording uses Private on-device transcription');
    expect(surfaces.legal).toContain('Retention duration and deletion timing are still being finalized; use Report Issue for a data-retention request.');
    expect(surfaces.legal).toContain('use Report Issue for account, privacy, retention, or data questions');
    expect(surfaces.legal).toContain('continued access is $10/month');
    expect(surfaces.legal).toContain('Paid continuation is $10/month, but checkout is not yet enabled');
    expect(surfaces.testerGuide).toContain('Every customer practice session uses Private transcription on your device');
    expect(surfaces.testerGuide).toContain('free for 30 days');
    expect(surfaces.testerGuide).toContain('$10/month');
  });

  it('forbids the retired customer propositions', () => {
    expect(customerCopy).not.toMatch(/Browser transcription|Cloud transcription|Private sample|Cloud · external server|Browser · on this device/i);
    expect(customerCopy).not.toMatch(/(?:choose|select|switch(?:es|ed|ing)? to|available (?:as|through)|offered (?:as|through))\s+(?:the\s+)?Cloud|Cloud\s+(?:choice|option|mode|offer|plan|availability)/i);
    expect(customerCopy).not.toMatch(/Pro adds private|upgrade (?:to Pro )?(?:for|when you want|to get) Private|Private (?:is|as) (?:a )?(?:Pro|paid)|Private transcription (?:is )?(?:a )?paid/i);
    expect(surfaces.legal).not.toMatch(/delete your account|account deletion (?:is|can|will)|newest[- ]two/i);
    // #1266 — the retired commercial framing must not reappear on any customer surface:
    expect(customerCopy).not.toMatch(/\$9\.99/); // the offer is $10/month, not $9.99
    expect(customerCopy).not.toMatch(/permanently free|free forever|permanent(?:ly)? free tier/i); // no permanent Free tier
    expect(customerCopy).not.toMatch(/Pro adds|adds deeper history|for every plan/i); // Pro is continuation, not extra features
    expect(customerCopy).not.toMatch(/2 hours\/day|50 hours\/month|1-hour Free|2-hour Pro|50-hour Pro|25-hour Free/i); // no invented fair-use numbers
  });

  it('keeps free-beta and paid-enrollment claims under the same runtime condition as checkout', () => {
    expect(surfaces.signup).toContain("const paymentsEnabled = arePaymentsEnabled()");
    expect(surfaces.pricing).toContain('const paymentsEnabled = arePaymentsEnabled()');
    expect(surfaces.legal).toContain('const paymentsEnabled = arePaymentsEnabled()');
    expect(surfaces.analytics).toContain('arePaymentsEnabled()');
    expect(surfaces.upgradePrompt).toContain('if (!arePaymentsEnabled()) return null;');
  });
});
