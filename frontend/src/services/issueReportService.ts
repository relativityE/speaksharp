import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import { emitPrivateSample, getLastSampleArm, PRIVATE_SAMPLE_EVENTS } from '@/services/transcription/privateSampleTelemetry';

// Stable slugs stored in the DB (never the display labels). The visible, user-facing labels
// are mapped in IssueReportDialog. Kept in sync with the user_issue_reports_category_safe
// DB CHECK constraint (see migration 20260710000000_user_issue_reports_category_slugs.sql).
export type IssueReportCategory =
  | 'recording_transcription'
  | 'analytics_sessions'
  | 'billing_subscription'
  | 'account_signin'
  | 'privacy_data'
  | 'speed_performance'
  | 'something_else';
export type IssueReportSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface IssueReportMetadata {
  route: string;
  releaseProofEligible?: boolean;
  appRuntimeConfig?: unknown;
  userAgent?: string;
  viewport?: { width: number; height: number };
  timezone?: string;
  plan?: string | null;
  sttMode?: TranscriptionMode | null;
  runtimeState?: string | null;
  sentryLastEventId?: string | null;
}

export interface SubmitIssueReportInput {
  /**
   * The submitter's account id (Option B): attached for ALL authenticated reports so support can
   * follow up. It is an opaque auth UUID — no email/name is stored in the row. Nullable only as a
   * defensive fallback (e.g. no active session); callers on authenticated surfaces always pass it.
   * The insert runs under an authenticated session (RLS `TO authenticated`), so reports are not
   * internet-spammable.
   */
  userId?: string | null;
  sessionId?: string | null;
  category: IssueReportCategory;
  severity: IssueReportSeverity;
  title: string;
  description: string;
  pageUrl: string;
  metadata: IssueReportMetadata;
  includeTranscript: boolean;
  transcriptExcerpt?: string | null;
  includeAudio: boolean;
  audioAttachmentNote?: string | null;
}

const sanitizeOptionalText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export const buildIssueReportMetadata = (input: {
  route: string;
  plan?: string | null;
  sttMode?: TranscriptionMode | null;
  runtimeState?: string | null;
}): IssueReportMetadata => {
  const runtimeConfig = typeof window !== 'undefined' ? window.__APP_RUNTIME_CONFIG__ : undefined;
  const sentry = typeof window !== 'undefined'
    ? (window as unknown as { Sentry?: { lastEventId?: () => string | null } }).Sentry
    : undefined;

  return {
    route: input.route,
    plan: input.plan ?? null,
    sttMode: input.sttMode ?? null,
    runtimeState: input.runtimeState ?? null,
    releaseProofEligible: runtimeConfig?.releaseProofEligible,
    appRuntimeConfig: runtimeConfig,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    viewport: typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight } : undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sentryLastEventId: sentry?.lastEventId?.() ?? null,
  };
};

export const issueReportService = {
  async submit(input: SubmitIssueReportInput): Promise<{ id: string | null }> {
    const supabase = getSupabaseClient();
    const transcriptExcerpt = input.includeTranscript ? sanitizeOptionalText(input.transcriptExcerpt) : null;
    const audioAttachmentNote = input.includeAudio ? sanitizeOptionalText(input.audioAttachmentNote) : null;

    // Store-first: persist the complete report and capture its durable id. `.select('id')` (no
    // single()) returns [] rather than throwing when RLS won't return the row (e.g. an anonymous
    // report where the SELECT policy is own-reports-only), so submission never regresses.
    const { data, error } = await supabase
      .from('user_issue_reports')
      .insert({
        user_id: input.userId ?? null,
        session_id: input.sessionId ?? null,
        category: input.category,
        severity: input.severity,
        title: input.title.trim(),
        description: input.description.trim(),
        page_url: input.pageUrl,
        metadata: input.metadata,
        include_transcript: input.includeTranscript,
        transcript_excerpt: transcriptExcerpt,
        include_audio: input.includeAudio,
        audio_attachment_note: audioAttachmentNote,
      })
      .select('id');

    if (error) {
      logger.error({ error, category: input.category, severity: input.severity }, '[issueReportService.submit]');
      throw error;
    }

    const reportId: string | null = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;

    // Non-PII analytics breadcrumb so a Report Issue can be correlated to the user's
    // journey (session id, and the Private arm/release via the active sample context).
    // The strict allowlist guarantees no title/description/transcript/audio rides along.
    const arm = getLastSampleArm();
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.REPORT_ISSUE_SUBMITTED, {
      issue_category: input.category,
      issue_severity: input.severity,
      session_id: input.sessionId ?? arm.session_id ?? null,
      engine_variant: arm.engine_variant ?? null,
      release_sha: arm.release_sha ?? null,
    });

    // P0.4: after the report is safely stored, trigger the trusted-backend owner alert. This is
    // fire-and-forget — the report is already persisted, so submission success never depends on the
    // alert, and alert latency never blocks the UI. Only the durable report id is passed (never any
    // report content); the backend builds the sanitized alert from the stored row. Anonymous reports
    // (no returnable id) simply skip the client trigger.
    if (reportId) {
      void triggerOwnerAlert(supabase, reportId);
    }

    return { id: reportId };
  },
};

async function triggerOwnerAlert(
  supabase: ReturnType<typeof getSupabaseClient>,
  reportId: string,
): Promise<void> {
  try {
    await supabase.functions.invoke('report-issue-alert', { body: { reportId } });
  } catch {
    // Never rethrow: the report is already stored and the backend tracks delivery state durably.
    // Log without any report content.
    logger.debug({ scope: 'report-issue-alert', reportId }, 'owner alert trigger failed (non-fatal)');
  }
}
