import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

export type IssueReportCategory = 'stt' | 'billing' | 'account' | 'analytics' | 'privacy' | 'performance' | 'general';
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
   * Optional (Option C): reports are anonymous by default — we store no identity and rely on the
   * row timestamp + sttMode/route metadata (and sentryLastEventId) to correlate with logs/Sentry.
   * The insert still runs under an authenticated session (RLS `TO authenticated`), so reports are
   * not internet-spammable; we simply do not record WHO submitted.
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
  async submit(input: SubmitIssueReportInput): Promise<{ id: string }> {
    const supabase = getSupabaseClient();
    const transcriptExcerpt = input.includeTranscript ? sanitizeOptionalText(input.transcriptExcerpt) : null;
    const audioAttachmentNote = input.includeAudio ? sanitizeOptionalText(input.audioAttachmentNote) : null;

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
      .select('id')
      .single();

    if (error) {
      logger.error({ error, category: input.category, severity: input.severity }, '[issueReportService.submit]');
      throw error;
    }

    return { id: String(data.id) };
  },
};
