import posthog from 'posthog-js';
import logger from '@/lib/logger';

/**
 * Report Issue telemetry — the ONE explicit, user-initiated exception to the passive, content-free
 * Private-engine telemetry boundary (`privateTelemetry.ts`). A user who opens "Report an issue" and submits
 * is deliberately sending their own support content: the title + description they typed, and — ONLY when
 * they tick the transcript box and supply a nonblank snippet — a bounded transcript excerpt.
 *
 * This projection is DEDICATED and NARROW. It permits exactly:
 *   - the user-submitted support fields (issue_title, issue_description, optional issue_transcript_snippet);
 *   - the content-free correlation breadcrumb (category / severity / session / engine / release).
 * It NEVER carries audio, audio notes, name, email, password/credential/token material, raw user id, the
 * full transcript, a raw URL / query / fragment, or unrelated session content — those are simply never read
 * into the payload (allowlist by construction). It does not touch and cannot widen
 * `sanitizePrivateTelemetryProps`, which stays strictly content-free for every passive engineering event.
 */

export const REPORT_ISSUE_EVENT = 'report_issue_submitted';

// Service-boundary bounds — re-enforced here even though IssueReportDialog also bounds the same inputs.
export const REPORT_ISSUE_BOUNDS = { title: 160, description: 5000, transcriptSnippet: 4000 } as const;

const boundedTrim = (value: string | null | undefined, max: number): string | null => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

export interface ReportIssueTelemetryInput {
  category: string;
  severity: string;
  sessionId?: string | null;
  engineVariant?: string | null;
  releaseSha?: string | null;
  title: string;
  description: string;
  /** True ONLY when the user explicitly ticked the transcript option in the dialog. */
  includeTranscript: boolean;
  transcriptExcerpt?: string | null;
}

export interface ReportIssueTelemetryProps {
  issue_category: string;
  issue_severity: string;
  session_id: string | null;
  engine_variant: string | null;
  release_sha: string | null;
  issue_title: string | null;
  issue_description: string | null;
  /** Present ONLY when the user opted in AND supplied a nonblank snippet (bounded). */
  issue_transcript_snippet?: string;
}

/**
 * Build the dedicated, narrowly-allowlisted Report Issue projection. Reads ONLY the allowed fields from the
 * input; a prohibited field cannot appear because it is never copied. Values are trimmed + bounded here.
 */
export function buildReportIssueTelemetryProps(input: ReportIssueTelemetryInput): ReportIssueTelemetryProps {
  const props: ReportIssueTelemetryProps = {
    issue_category: input.category,
    issue_severity: input.severity,
    session_id: input.sessionId ?? null,
    engine_variant: input.engineVariant ?? null,
    release_sha: input.releaseSha ?? null,
    issue_title: boundedTrim(input.title, REPORT_ISSUE_BOUNDS.title),
    issue_description: boundedTrim(input.description, REPORT_ISSUE_BOUNDS.description),
  };
  // Transcript snippet is included ONLY when the user explicitly opted in AND supplied a nonblank snippet.
  if (input.includeTranscript) {
    const snippet = boundedTrim(input.transcriptExcerpt, REPORT_ISSUE_BOUNDS.transcriptSnippet);
    if (snippet) props.issue_transcript_snippet = snippet;
  }
  return props;
}

/**
 * Emit the Report Issue breadcrumb AFTER authoritative report persistence only. Fails closed: any telemetry
 * error is swallowed so it can never mask a report that already persisted successfully.
 */
export function emitReportIssueSubmitted(input: ReportIssueTelemetryInput): void {
  try {
    const props = buildReportIssueTelemetryProps(input);
    logger.info({ event: REPORT_ISSUE_EVENT, issue_category: props.issue_category, issue_severity: props.issue_severity }, '[REPORT_ISSUE_TELEMETRY]');
    posthog?.capture?.(REPORT_ISSUE_EVENT, props);
    if (typeof window !== 'undefined') {
      const target = window as unknown as { __SS_PRIVATE_EVENTS__?: Array<Record<string, unknown>> };
      if (!Array.isArray(target.__SS_PRIVATE_EVENTS__)) target.__SS_PRIVATE_EVENTS__ = [];
      target.__SS_PRIVATE_EVENTS__.push({ event: REPORT_ISSUE_EVENT, ts: Date.now(), ...props });
      if (target.__SS_PRIVATE_EVENTS__.length > 200) target.__SS_PRIVATE_EVENTS__.splice(0, target.__SS_PRIVATE_EVENTS__.length - 200);
    }
  } catch {
    // Telemetry never affects a successfully-persisted report.
  }
}
