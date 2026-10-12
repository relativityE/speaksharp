/**
 * First-party, short-lived link from a saved coaching session to its opaque diagnostic request id.
 *
 * The session id stays in tab-local storage only; it is never sent to telemetry. Share Feedback may
 * attach a diagnostic id only when the user selected the exact same saved session. There is no
 * "current session" fallback for an older selection or for No session.
 */
const STORAGE_KEY = 'speaksharp.coaching-diagnostic-links.v1';
const MAX_LINKS = 12;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LinkRecord {
  sessionId: string;
  requestId: string;
  recordedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readRecords(now: number): LinkRecord[] {
  const target = storage();
  if (!target) return [];
  try {
    const raw: unknown = JSON.parse(target.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((value): value is LinkRecord => {
      if (!value || typeof value !== 'object') return false;
      const row = value as Partial<LinkRecord>;
      return typeof row.sessionId === 'string' && UUID_V4.test(row.sessionId)
        && typeof row.requestId === 'string' && UUID_V4.test(row.requestId)
        && Number.isSafeInteger(row.recordedAt) && Number(row.recordedAt) <= now
        && now - Number(row.recordedAt) <= MAX_AGE_MS;
    }).slice(0, MAX_LINKS);
  } catch {
    return [];
  }
}

/** Generate a correlation token only from the browser's cryptographic RNG. No weak fallback. */
export function createCoachingDiagnosticId(): string | null {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    return typeof randomUUID === 'function' ? randomUUID.call(globalThis.crypto) : null;
  } catch {
    return null;
  }
}

/** Remember the exact session/request pair for this tab. Returns false if storage is unavailable. */
export function rememberCoachingDiagnostic(
  sessionId: string,
  requestId: string,
  now = Date.now(),
): boolean {
  if (!UUID_V4.test(sessionId) || !UUID_V4.test(requestId) || !Number.isSafeInteger(now)) return false;
  const target = storage();
  if (!target) return false;
  const records = readRecords(now).filter((record) => record.sessionId !== sessionId);
  records.unshift({ sessionId, requestId, recordedAt: now });
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_LINKS)));
    return true;
  } catch {
    return false;
  }
}

/** Return a reference only for the exact selected session; null means no diagnostic link is proven. */
export function coachingDiagnosticForSession(sessionId: string | null, now = Date.now()): string | null {
  if (!sessionId || !UUID_V4.test(sessionId)) return null;
  return readRecords(now).find((record) => record.sessionId === sessionId)?.requestId ?? null;
}

export function __resetCoachingDiagnosticLinksForTests(): void {
  try { storage()?.removeItem(STORAGE_KEY); } catch { /* unavailable storage is a valid test condition */ }
}
