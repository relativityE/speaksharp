// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import type { FillerDivergenceReport, SanitizedFillerArtifact } from '@/services/telemetry/fillerDivergence';

vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/storage', () => ({
  saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
  heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
  completeSession: vi.fn().mockResolvedValue({ success: true }),
  updateSession: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../lib/supabaseClient', () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
  })),
}));

describe('SpeechRuntimeController — filler divergence report (Phase 5.8 precursor, diagnostics-only)', () => {
  let controller: SpeechRuntimeController;

  beforeEach(() => {
    vi.useFakeTimers();
    (SpeechRuntimeController as unknown as { __resetForTests: () => void }).__resetForTests();
    controller = SpeechRuntimeController.getInstance();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the CACHED finalization report — survives shadow-engine disposal, no live-store read', () => {
    const c = controller as unknown as {
      lastFillerDivergenceReport: FillerDivergenceReport | null;
      shadowEngine: unknown;
    };

    // No report before a finalization has run.
    expect(controller.getFillerDivergenceReport()).toBeNull();

    // Simulate the report cached at finalization (computed over the save-selected finalTranscript, with the
    // live filler counts snapshotted before the store correction). Numbers only.
    const cached: FillerDivergenceReport = {
      engine: 'private', liveFillerCount: 4, recountFillerCount: 1, delta: -3, match: false,
      clarityLive: 18, clarityRecount: 68, clarityDelta: 50, scoreLive: 3, scoreRecount: 4.3, scoreDelta: 1.3,
      usedCustomWords: false, category: 'private-finalize-replacement', selectedSource: 'service_result',
    };
    c.lastFillerDivergenceReport = cached;

    // The shadow engine has been disposed after stop — the getter must NOT depend on it.
    c.shadowEngine = null;
    expect(controller.getFillerDivergenceReport()).toEqual(cached);

    // Numbers/enum only — no transcript text keys.
    const keys = Object.keys(controller.getFillerDivergenceReport()!);
    expect(keys).not.toContain('transcript');
    expect(keys).not.toContain('text');
  });

  it('Step 1: sanitized filler artifact is exposed on the dev/test debug hook — numbers-only', () => {
    const c = controller as unknown as { lastFillerArtifact: SanitizedFillerArtifact | null };

    // Simulate the artifact cached at finalization (custom word already anonymized to custom_1).
    const artifact: SanitizedFillerArtifact = {
      engine: 'private', selectedSource: 'service_result',
      liveFillerCount: 9, recountFillerCount: 3, delta: -6,
      clarityLive: 10, clarityRecount: 62, clarityDelta: 52,
      scoreLive: 2.9, scoreRecount: 4.8, scoreDelta: 1.9,
      usedCustomWords: true,
      liveDetail: { um: 4, so: 2, custom_1: 3 },
      recountDetail: { um: 1, so: 1, custom_1: 1 },
    };
    c.lastFillerArtifact = artifact;

    // In the test env the flag is ON → getter returns it.
    expect(controller.getSanitizedFillerArtifact()).toEqual(artifact);

    // Exposed on the dev/test debug hook.
    const dbg = (window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown> }).__SPEECH_RUNTIME_DEBUG__?.();
    expect(dbg?.fillerDivergence).toEqual(artifact);

    // Numbers/enum only — no transcript text, no raw custom-word text anywhere.
    expect(JSON.stringify(artifact)).not.toContain('honestly');
    // Every detail key is an allowlisted static filler label or an anonymized custom_N — never free text.
    const allowed = /^(um|uh|ah|like|You Know|so|actually|oh|I Mean|basically|literally|Kind Of|Sort Of|custom_\d+|custom_other)$/;
    for (const key of [...Object.keys(artifact.liveDetail), ...Object.keys(artifact.recountDetail)]) {
      expect(key).toMatch(allowed);
    }
  });
});
