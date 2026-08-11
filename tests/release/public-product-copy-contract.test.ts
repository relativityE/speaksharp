import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
};

const stringLiterals = (source: string) =>
  [...source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? '');

const customerCopy = Object.values(surfaces).flatMap(stringLiterals).join('\n');

describe('Private-only public product copy contract (#1254)', () => {
  it('locks the exact product truth on every customer surface', () => {
    expect(surfaces.signup).toContain('Start free with Private transcription');
    expect(surfaces.signup).toContain('Every practice session uses on-device Private transcription. The controlled beta is free — no card or checkout.');
    expect(surfaces.practice).toContain('See which points were detected — and what to retry');
    expect(surfaces.pricing).toContain('Start the controlled beta with Private on-device transcription and focused feedback. No card or checkout is required.');
    expect(surfaces.analytics).toContain('Pro adds deeper history and expanded coaching capacity. Private transcription remains on-device for every plan.');
    expect(surfaces.upgradePrompt).toContain('Private transcription remains on-device for every plan.');
    expect(surfaces.legal).toContain('Every customer recording uses Private on-device transcription');
    expect(surfaces.legal).toContain('Retention duration and deletion timing are still being finalized; use Report Issue for a data-retention request.');
    expect(surfaces.testerGuide).toContain('Every customer practice session uses Private transcription on your device');
    expect(surfaces.testerGuide).toContain('The controlled beta is free. No card or checkout is required.');
  });

  it('forbids the retired customer propositions', () => {
    expect(customerCopy).not.toMatch(/Browser transcription|Cloud transcription|Private sample|Cloud · external server|Browser · on this device/i);
    expect(customerCopy).not.toMatch(/Pro adds private|upgrade (?:to Pro )?(?:for|when you want|to get) Private|Private (?:is|as) (?:a )?(?:Pro|paid)|Private transcription (?:is )?(?:a )?paid/i);
  });
});
