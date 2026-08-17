// @vitest-environment happy-dom
//
// #1306 P1-1 — PRODUCTION diagnostics carry only codes/numbers/LENGTHS, never transcript text.
//
// The controller's diagnostic read surfaces (window.__SPEECH_RUNTIME_DEBUG__, the save-candidate debug, and
// the native trace ring) may expose the ephemeral transcript ONLY in test/dev builds (ENV.isTest), for the
// proof/WER/repetition harnesses. In production (ENV.isTest === false) they must expose LENGTHS only, so no
// spoken prose is ever readable from a production global. ENV.isTest === (isE2E || isUnit); isUnit reads
// globalThis.__TEST__, so we flip it to exercise the production branch at call time.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '@/services/SpeechRuntimeController';

const CANARY = 'today I confessed the secret merger numbers out loud';

type DebugFn = () => Record<string, unknown>;
type TestGlobal = typeof globalThis & { __TEST__?: boolean };
// Standalone view (NOT extending Window — __SS_E2E__ is already typed there) reached via an explicit cast.
type E2EWindow = { __SPEECH_RUNTIME_DEBUG__?: DebugFn; __SS_E2E__?: { isActive?: boolean } };

describe('#1306 P1-1 — production diagnostics expose lengths only (no transcript text)', () => {
  let prevTest: boolean | undefined;
  let prevE2E: { isActive?: boolean } | undefined;

  beforeEach(() => {
    prevTest = (globalThis as TestGlobal).__TEST__;
    prevE2E = (window as E2EWindow).__SS_E2E__;
  });
  afterEach(() => {
    (globalThis as TestGlobal).__TEST__ = prevTest;
    (window as E2EWindow).__SS_E2E__ = prevE2E;
  });

  it('__SPEECH_RUNTIME_DEBUG__ omits the transcript text and exposes its LENGTH in production', () => {
    const controller = SpeechRuntimeController.getInstance();
    // Seed a selected transcript into the controller lifecycle (as a real finalize would).
    (controller as unknown as { transcriptLifecycle: { selectedTranscriptForSave: string | null } })
      .transcriptLifecycle.selectedTranscriptForSave = CANARY;

    const debug = (window as E2EWindow).__SPEECH_RUNTIME_DEBUG__;
    expect(typeof debug).toBe('function');

    // --- TEST/DEV build: text IS present (harness needs it) ---
    (globalThis as TestGlobal).__TEST__ = true;
    (window as E2EWindow).__SS_E2E__ = undefined;
    const devView = debug!();
    expect(devView.selectedTranscriptForSaveLength).toBe(CANARY.length);
    expect(devView.selectedTranscriptForSave).toBe(CANARY);

    // --- PRODUCTION build: text is GONE, only the length remains ---
    (globalThis as TestGlobal).__TEST__ = false;
    (window as E2EWindow).__SS_E2E__ = undefined;
    const prodView = debug!();
    expect(prodView.selectedTranscriptForSaveLength).toBe(CANARY.length);
    expect(prodView).not.toHaveProperty('selectedTranscriptForSave');
    // Falsification: no canary word appears anywhere in the serialized production diagnostic.
    expect(JSON.stringify(prodView)).not.toMatch(/confessed|secret|merger/i);
  });
});
