import type { PracticeSession } from '@/types/session';

const isMeaningfulDetail = (value: string | null | undefined): value is string => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'unknown' && normalized !== 'n/a';
};

export const getUserFacingEngineLabel = (session: Pick<PracticeSession, 'engine'>): string => {
  const engine = (session.engine || '').toLowerCase();

  if (engine.includes('cloud') || engine.includes('assembly')) return 'Cloud';
  if (engine.includes('private') || engine.includes('whisper') || engine.includes('transformers')) return 'Private';
  if (engine.includes('native') || engine.includes('browser')) return 'Native Browser';

  return 'Not recorded';
};

export const formatSessionRecordingMode = (
  session: Pick<PracticeSession, 'engine' | 'model_name' | 'engine_version' | 'device_type'>
): string => {
  const mode = getUserFacingEngineLabel(session);
  const details = [session.model_name, session.engine_version, session.device_type].filter(isMeaningfulDetail);

  return details.length > 0 ? `${mode} (${details.join(', ')})` : mode;
};
