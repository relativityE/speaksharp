import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import { emitPrivateTelemetry, getLastPrivateIdentity, PRIVATE_TELEMETRY_EVENTS } from '@/services/transcription/privateTelemetry';
import { issueAreasForContext, type PageContext } from '@/services/pageContext';
import { pickPersistedRuntimeConfig, type PersistedRuntimeConfig } from '@/config/appRuntimeConfig';
import { emitFeedbackSubmit } from '@/services/telemetry/feedbackTelemetry';

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

/** #1404 — Issue means something is broken; Comment is everything else a user wants to tell us. */
export type FeedbackKind = 'issue' | 'comment';

/**
 * #1408 — the severity a COMMENT carries.
 *
 * A Comment has no impact rating. Storing 'low' or 'medium' would be a placeholder the database then
 * vouches for, and every consumer that ranks by severity would rank praise beside defects. This value
 * has no position in the defect ordering, so accidental ranking is impossible rather than merely
 * discouraged.
 */
export const COMMENT_SEVERITY = 'not_applicable' as const;
export const FEEDBACK_KINDS: FeedbackKind[] = ['issue', 'comment'];
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = { issue: 'Issue', comment: 'Comment' };

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
  /**
   * #1404 — which KIND of message this is. The form now serves feedback that is not a defect, and a
   * comment filed as an issue is noise in the support queue. Stored in the existing metadata
   * deliberately: no schema change, no new table, and `report_issue` stays the backend name.
   *
   * The STORED key is snake_case by explicit instruction, unlike its camelCase siblings — support
   * tooling reads `feedback_kind`. The local variable stays `feedbackKind`.
   */
  feedback_kind?: FeedbackKind | null;
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
  // #1306 metrics-only: a report NEVER carries a transcript excerpt or any session speech. Only the user's
  // own typed title/description + an optional audio-debug note cross the boundary.
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
  feedbackKind?: FeedbackKind | null;
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
    // Same allowlist rule as issueArea: the select is not trusted as the sole gate. An unrecognised or
    // absent value stores NULL rather than guessing 'issue' — the form now requires an explicit choice,
    // so a missing kind means something bypassed the form, and inventing one would hide that.
    feedback_kind: input.feedbackKind && FEEDBACK_KINDS.includes(input.feedbackKind) ? input.feedbackKind : null,
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
    const audioAttachmentNote = input.includeAudio ? sanitizeOptionalText(input.audioAttachmentNote) : null;

    // #1306 metrics-only: the insert is transcript-free — no include_transcript / transcript_excerpt columns
    // are written (the column is dropped by the Stage B enforcement migration). Only the user's typed fields +
    // sanitized operational metadata + an optional audio-debug note are persisted.
    // THE ONE VALUE, used for both the row and the telemetry boolean. Computing them separately is
    // what let them disagree.
    const persistedSessionId = input.sessionId ?? null;

    const { error } = await supabase
      .from('user_issue_reports')
      .insert({
        user_id: input.userId ?? null,
        session_id: persistedSessionId,
        category: input.category,
        severity: input.severity,
        title: input.title.trim(),
        description: input.description.trim(),
        page_url: input.pageUrl,
        metadata: input.metadata,
        include_audio: input.includeAudio,
        audio_attachment_note: audioAttachmentNote,
      });

    if (error) {
      logger.error({ error, category: input.category, severity: input.severity }, '[issueReportService.submit]');
      // #1259 F09 — a storage failure currently reaches analytics as SILENCE, because
      // `report_issue_submitted` is emitted only on the success path below. Silence is also what a
      // user who never opened the dialog produces, so the two are indistinguishable — which is
      // exactly the ambiguity the live session left us with.
      emitFeedbackSubmit({ outcome: 'storage_failed', acknowledgementVisible: false });
      throw error;
    }

    // Non-PII analytics breadcrumb so a Report Issue can be correlated to the user's journey (whether
    // it is linked to a session, plus the most recent content-free Private engine identity). The strict
    // allowlist guarantees no title/description/transcript/audio rides along.
    //
    // THE LINK, NOT THE IDENTIFIER. This sent a raw session UUID to the analytics vendor, so every
    // report carried a stable per-session identifier — enough to re-identify a session from analytics
    // alone. The wire only needs to answer whether the report is linked to a session at all.
    //
    // DERIVED FROM WHAT WAS INSERTED, not from a wider fallback. The first version computed this from
    // `input.sessionId ?? arm.session_id`, so a report with no session on its ROW could still emit
    // `report_linked_to_session: true` on the strength of the last engine identity seen in this tab.
    // That is a claim about the database made from something the database never saw — the same
    // intention-over-evidence error as reporting a requested model instead of the one that ran, and it
    // would have made the funnel's linkage rate quietly wrong in the optimistic direction.
    //
    // The fallback also never reached the row: it existed in the analytics vendor and nowhere else.
    // ATTRIBUTION FOLLOWS THE LINK, NOT THE TAB.
    //
    // `getLastPrivateIdentity()` is process-global: it holds whatever engine most recently resolved in
    // this tab, which is not necessarily the engine that produced the session this report is about. A
    // report filed with no linked session — or filed after switching models — was attributed to the
    // current arm anyway, so a complaint about Moonshine could be filed under v2 and counted against it.
    //
    // With no persisted session there is nothing to attribute the report TO, and the honest answer is
    // explicit: `null` with `model_attribution_verified: false`. Naming the most recent engine would be
    // a guess that reads downstream exactly like a measurement.
    const arm = getLastPrivateIdentity();
    const linked = persistedSessionId !== null;
    // Verified only when the report is linked AND the identity we hold belongs to that same session.
    const attributionVerified = linked && arm.session_id === persistedSessionId;
    emitFeedbackSubmit({ outcome: 'storage_ok', acknowledgementVisible: true });
    emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.REPORT_ISSUE_SUBMITTED, {
      issue_category: input.category,
      issue_severity: input.severity,
      report_linked_to_session: linked,
      model_attribution_verified: attributionVerified,
      engine_variant: attributionVerified ? (arm.engine_variant ?? null) : null,
      release_sha: attributionVerified ? (arm.release_sha ?? null) : null,
    });

    return { id: null };
  },
};
