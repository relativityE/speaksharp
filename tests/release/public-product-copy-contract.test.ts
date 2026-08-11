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
    expect(surfaces.signup).toContain('Start free with Private transcription');
    expect(surfaces.signup).toContain('Every practice session uses on-device Private transcription. The controlled beta is free — no card or checkout.');
    expect(surfaces.signup).toContain('Every practice session uses on-device Private transcription. The free path requires no card or checkout.');
    expect(surfaces.practice).toContain('See which points were detected — and what to retry');
    expect(surfaces.pricing).toContain('Start the controlled beta with Private on-device transcription and focused feedback. No card or checkout is required.');
    expect(surfaces.analytics).toContain('Pro adds deeper history and expanded coaching capacity. Private transcription remains on-device for every plan.');
    expect(surfaces.upgradePrompt).toContain('Private transcription remains on-device for every plan.');
    expect(surfaces.legal).toContain('Every customer recording uses Private on-device transcription');
    expect(surfaces.legal).toContain('Retention duration and deletion timing are still being finalized; use Report Issue for a data-retention request.');
    expect(surfaces.legal).toContain('use Report Issue for account, privacy, retention, or data questions');
    expect(surfaces.legal).toContain('Paid Pro enrollment is available.');
    expect(surfaces.legal).toContain('Paid enrollment and checkout are not currently offered during the controlled beta.');
    expect(surfaces.testerGuide).toContain('Every customer practice session uses Private transcription on your device');
    expect(surfaces.testerGuide).toContain('When paid enrollment is disabled, the controlled beta is **free** and no checkout is shown.');
    expect(surfaces.testerGuide).toContain('The free practice path never requires a card.');
  });

  it('forbids the retired customer propositions', () => {
    expect(customerCopy).not.toMatch(/Browser transcription|Cloud transcription|Private sample|Cloud · external server|Browser · on this device/i);
    expect(customerCopy).not.toMatch(/(?:choose|select|switch(?:es|ed|ing)? to|available (?:as|through)|offered (?:as|through))\s+(?:the\s+)?Cloud|Cloud\s+(?:choice|option|mode|offer|plan|availability)/i);
    expect(customerCopy).not.toMatch(/Pro adds private|upgrade (?:to Pro )?(?:for|when you want|to get) Private|Private (?:is|as) (?:a )?(?:Pro|paid)|Private transcription (?:is )?(?:a )?paid/i);
    expect(surfaces.legal).not.toMatch(/delete your account|account deletion (?:is|can|will)|newest[- ]two/i);
  });

  it('keeps free-beta and paid-enrollment claims under the same runtime condition as checkout', () => {
    expect(surfaces.signup).toContain("const paymentsEnabled = arePaymentsEnabled()");
    expect(surfaces.pricing).toContain('const paymentsEnabled = arePaymentsEnabled()');
    expect(surfaces.legal).toContain('const paymentsEnabled = arePaymentsEnabled()');
    expect(surfaces.analytics).toContain('arePaymentsEnabled()');
    expect(surfaces.upgradePrompt).toContain('if (!arePaymentsEnabled()) return null;');
  });
});
