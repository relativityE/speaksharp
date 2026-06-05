import type { PracticeSession } from '@/types/session';

export const getUserFacingEngineLabel = (session: Pick<PracticeSession, 'engine'>): string => {
  const engine = (session.engine || '').toLowerCase();

  if (engine.includes('cloud') || engine.includes('assembly')) return 'Cloud';
  if (engine.includes('private') || engine.includes('whisper') || engine.includes('transformers')) return 'Private';
  if (engine.includes('native') || engine.includes('browser')) return 'Native Browser';

  return 'Not recorded';
};

/**
 * User-facing recording-mode label. Returns ONLY the friendly mode (Private / Native Browser /
 * Cloud) — it deliberately does NOT expose raw model/engine/device names like "whisper-base.en"
 * or "transformers-js" in user copy (release-audit item-8). The technical identity is preserved
 * in the saved session metadata (model_name / engine_version / device_type) and surfaced via
 * `data-*` attributes for tests/telemetry, never in visible text.
 */
export const formatSessionRecordingMode = (session: Pick<PracticeSession, 'engine'>): string => {
  return getUserFacingEngineLabel(session);
};
