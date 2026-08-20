import type { PracticeSession } from '@/types/session';

export const getUserFacingEngineLabel = (session: Pick<PracticeSession, 'engine'>): string => {
  const engine = (session.engine || '').toLowerCase();

  if (engine.includes('private') || engine.includes('whisper') || engine.includes('transformers')) return 'Private';
  if (engine) return 'Legacy recording';
  return 'Not recorded';
};

/**
 * User-facing recording-mode label. Current Private rows are truthful; every historical non-Private
 * row receives one neutral legacy label. It deliberately does NOT expose raw model/engine/device names
 * or "transformers-js" in user copy (release-audit item-8). The technical identity is preserved
 * in the saved session metadata (model_name / engine_version / device_type) and surfaced via
 * `data-*` attributes for tests/telemetry, never in visible text.
 */
export const formatSessionRecordingMode = (session: Pick<PracticeSession, 'engine'>): string => {
  return getUserFacingEngineLabel(session);
};
