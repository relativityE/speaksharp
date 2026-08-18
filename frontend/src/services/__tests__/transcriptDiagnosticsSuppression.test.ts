// @vitest-environment happy-dom
//
// #1306 P1-1 — diagnostics carry only codes/numbers/LENGTHS, NEVER transcript text — in EVERY build.
//
// Test/E2E/real-device artifacts are inside the privacy boundary too, so there is NO ENV.isTest exception:
// window.__SPEECH_RUNTIME_DEBUG__, the save-candidate debug, and the trace rings expose lengths only, always.
// We verify both the default (unit/test) build AND a simulated production build (globalThis.__TEST__ = false).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '@/services/SpeechRuntimeController';

const CANARY = 'today I confessed the secret merger numbers out loud';

type DebugFn = () => Record<string, unknown>;
type TestGlobal = typeof globalThis & { __TEST__?: boolean };
// Standalone view (NOT extending Window — __SS_E2E__ is already typed there) reached via an explicit cast.
type E2EWindow = { __SPEECH_RUNTIME_DEBUG__?: DebugFn; __SS_E2E__?: { isActive?: boolean } };

describe('#1306 P1-1 — diagnostics expose lengths only, in every build (no transcript text ever)', () => {
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

  it('__SPEECH_RUNTIME_DEBUG__ never exposes the transcript text; only its LENGTH — test AND production build', () => {
    const controller = SpeechRuntimeController.getInstance();
    // Seed a selected transcript into the controller lifecycle (as a real finalize would).
    (controller as unknown as { transcriptLifecycle: { selectedTranscriptForSave: string | null } })
      .transcriptLifecycle.selectedTranscriptForSave = CANARY;

    const debug = (window as E2EWindow).__SPEECH_RUNTIME_DEBUG__;
    expect(typeof debug).toBe('function');

    for (const isTestBuild of [true, false]) {
      (globalThis as TestGlobal).__TEST__ = isTestBuild;
      (window as E2EWindow).__SS_E2E__ = undefined;
      const view = debug!();
      // length is always present; the text is NEVER present, regardless of build.
      expect(view.selectedTranscriptForSaveLength).toBe(CANARY.length);
      expect(view).not.toHaveProperty('selectedTranscriptForSave');
      // Falsification: no canary word appears anywhere in the serialized diagnostic.
      expect(JSON.stringify(view)).not.toMatch(/confessed|secret|merger/i);
    }
  });
});
