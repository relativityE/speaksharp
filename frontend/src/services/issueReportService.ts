import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import { getLastPrivateIdentity } from '@/services/transcription/privateTelemetry';
import { emitReportIssueSubmitted } from '@/services/reportIssueTelemetry';
import { issueAreasForContext, type PageContext } from '@/services/pageContext';
import { pickPersistedRuntimeConfig, type PersistedRuntimeConfig } from '@/config/appRuntimeConfig';

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
  /** Sanitized route TEMPLATE (== canonicalRoute); never a full URL, query string, or hash. */
  route: string;
  // ── Allowlisted page context (page-aware reporting) — content-free, snapshotted at dialog-open ──
  pageKey?: string;
  pageLabel?: string;
  productMode?: string;
  journeyStep?: string;
  canonicalRoute?: string;
  /** Which of the three closed /practice surfaces the report came from (null off /practice). */
  practiceSurface?: string | null;
  issueArea?: string | null;
  /** Build/release id (git SHA in production) so a report pins to a build, when available. */
  releaseId?: string | null;
  releaseProofEligible?: boolean;
  /**
   * Allowlisted runtime facts ONLY (see pickPersistedRuntimeConfig). Never the raw runtime config —
   * that carries `url` (the full location.href with dynamic ids / query / fragment).
   */
  appRuntimeConfig?: PersistedRuntimeConfig;
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
  /** Allowlisted page context captured at dialog-open time. Its canonicalRoute becomes `route`. */
  context: PageContext;
  issueArea?: string | null;
  plan?: string | null;
  sttMode?: TranscriptionMode | null;
  runtimeState?: string | null;
}): IssueReportMetadata => {
  const runtimeConfig = typeof window !== 'undefined' ? window.__APP_RUNTIME_CONFIG__ : undefined;
  const sentry = typeof window !== 'undefined'
    ? (window as unknown as { Sentry?: { lastEventId?: () => string | null } }).Sentry
    : undefined;
  const { context } = input;
  // Allowlist rule: issueArea is stored ONLY if it is a valid slug for THIS resolved context — which on
  // /practice is the ACTIVE SURFACE's allowlist (Quick vs Objective vs home), not the whole page. Any
  // invalid, stale, cross-surface, injected, or empty value is coerced to null — the UI select is not
  // trusted as the sole gate.
  const validAreas = issueAreasForContext(context).map((a) => a.value);
  const issueArea = input.issueArea && validAreas.includes(input.issueArea) ? input.issueArea : null;

  return {
    // The stored route is the sanitized template — no full URL, query string, or hash.
    route: context.canonicalRoute,
    pageKey: context.pageKey,
    pageLabel: context.pageLabel,
    productMode: context.productMode,
    journeyStep: context.journeyStep,
    canonicalRoute: context.canonicalRoute,
    practiceSurface: context.practiceSurface ?? null,
    issueArea,
    releaseId: runtimeConfig?.release ?? null,
    plan: input.plan ?? null,
    sttMode: input.sttMode ?? null,
    runtimeState: input.runtimeState ?? null,
    releaseProofEligible: runtimeConfig?.releaseProofEligible,
    // Allowlist ONLY — strips `url` (raw location.href), `port`, and `supabaseUrl` so no dynamic route
    // id / query / fragment (session UUIDs, emails, invite/reset tokens) is ever persisted here.
    appRuntimeConfig: pickPersistedRuntimeConfig(runtimeConfig),
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

    const { error } = await supabase
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
      });

    if (error) {
      logger.error({ error, category: input.category, severity: input.severity }, '[issueReportService.submit]');
      throw error;
    }

    // #1294 ADDENDUM 3: emit the Report Issue breadcrumb ONLY after authoritative persistence, through the
    // DEDICATED reportIssueTelemetry emitter — the one explicit user-submitted support-content exception to
    // passive content-free telemetry. It carries the user's title + description and, ONLY when the user
    // opted in above, the same bounded transcript snippet that was persisted (never audio / name / email /
    // credentials / raw user id / full transcript / raw URL). A telemetry error here is swallowed so it can
    // never mask the report that already persisted. The generic Private allowlist is left untouched.
    const arm = getLastPrivateIdentity();
    try {
      emitReportIssueSubmitted({
        category: input.category,
        severity: input.severity,
        sessionId: input.sessionId ?? arm.session_id ?? null,
        engineVariant: arm.engine_variant ?? null,
        releaseSha: arm.release_sha ?? null,
        title: input.title,
        description: input.description,
        includeTranscript: input.includeTranscript,
        transcriptExcerpt,
      });
    } catch (telemetryError) {
      // Defense in depth: the emitter already fails closed, but a persisted report must NEVER be masked by
      // any telemetry error at the service boundary either.
      logger.warn({ telemetryError }, '[issueReportService.submit] report persisted; telemetry emit failed');
    }

    return { id: null };
  },
};
