import { describe, it, expect, vi, beforeEach } from 'vitest';
import posthog from 'posthog-js';
import {
  buildReportIssueTelemetryProps, emitReportIssueSubmitted, REPORT_ISSUE_BOUNDS, REPORT_ISSUE_EVENT,
  type ReportIssueTelemetryInput,
} from '@/services/reportIssueTelemetry';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));
const capture = vi.mocked(posthog.capture);

// A submission carrying user support content + several PROHIBITED fields that must never reach PostHog.
const baseInput: ReportIssueTelemetryInput = {
  category: 'recording_transcription',
  severity: 'high',
  sessionId: 'sess-1',
  engineVariant: 'private_v2',
  releaseSha: 'abc123',
  title: '  Transcription dropped a word  ',
  description: '  The final transcript missed "budget" near 0:42.  ',
  includeTranscript: false,
  transcriptExcerpt: null,
};

describe('#1294 ADDENDUM 3 — Report Issue telemetry carries user support content, nothing prohibited', () => {
  beforeEach(() => {
    capture.mockClear();
    (window as unknown as { __SS_PRIVATE_EVENTS__?: unknown[] }).__SS_PRIVATE_EVENTS__ = [];
  });

  it('includes the trimmed title + description in the PostHog Report Issue event', () => {
    emitReportIssueSubmitted(baseInput);
    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0];
    expect(event).toBe(REPORT_ISSUE_EVENT);
    expect(props).toMatchObject({
      issue_category: 'recording_transcription',
      issue_severity: 'high',
      session_id: 'sess-1',
      engine_variant: 'private_v2',
      release_sha: 'abc123',
      issue_title: 'Transcription dropped a word',
      issue_description: 'The final transcript missed "budget" near 0:42.',
    });
  });

  it('OMITS the transcript snippet by default (opt-in not selected)', () => {
    const props = buildReportIssueTelemetryProps({ ...baseInput, includeTranscript: false, transcriptExcerpt: 'secret words' });
    expect(props).not.toHaveProperty('issue_transcript_snippet');
    expect(JSON.stringify(props)).not.toContain('secret words');
  });

  it('INCLUDES a bounded transcript snippet only when the user opted in AND supplied a nonblank one', () => {
    const optedIn = buildReportIssueTelemetryProps({ ...baseInput, includeTranscript: true, transcriptExcerpt: '  around 0:42 I said budget  ' });
    expect(optedIn.issue_transcript_snippet).toBe('around 0:42 I said budget');
    // Opted in but blank → still omitted.
    const blank = buildReportIssueTelemetryProps({ ...baseInput, includeTranscript: true, transcriptExcerpt: '   ' });
    expect(blank).not.toHaveProperty('issue_transcript_snippet');
  });

  it('re-enforces the service-boundary bounds (title 160 / description 5000 / snippet 4000)', () => {
    const props = buildReportIssueTelemetryProps({
      ...baseInput,
      title: 'T'.repeat(500),
      description: 'D'.repeat(9000),
      includeTranscript: true,
      transcriptExcerpt: 'S'.repeat(9000),
    });
    expect(props.issue_title).toHaveLength(REPORT_ISSUE_BOUNDS.title);
    expect(props.issue_description).toHaveLength(REPORT_ISSUE_BOUNDS.description);
    expect(props.issue_transcript_snippet).toHaveLength(REPORT_ISSUE_BOUNDS.transcriptSnippet);
  });

  it('carries NONE of the prohibited fields (audio/name/email/credentials/user id/full URL)', () => {
    // Even if a hostile caller passes extra keys, only the allowlisted projection is built.
    const dirty = {
      ...baseInput,
      includeTranscript: true,
      transcriptExcerpt: 'ok snippet',
      audioAttachmentNote: 'audio blob note',
      email: 'user@example.com',
      name: 'Ada Lovelace',
      password: 'hunter2',
      access_token: 'tok_secret',
      userId: 'raw-user-uuid',
      pageUrl: 'https://app/session?token=leak#frag',
    } as unknown as ReportIssueTelemetryInput;
    const props = buildReportIssueTelemetryProps(dirty);
    const keys = Object.keys(props);
    expect(keys.sort()).toEqual([
      'engine_variant', 'issue_category', 'issue_description', 'issue_severity', 'issue_title',
      'issue_transcript_snippet', 'release_sha', 'session_id',
    ]);
    const serialized = JSON.stringify(props);
    for (const forbidden of ['user@example.com', 'Ada Lovelace', 'hunter2', 'tok_secret', 'raw-user-uuid', 'audio blob note', 'token=leak', '#frag']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('fails closed: a PostHog capture error never throws out of the emitter', () => {
    capture.mockImplementationOnce(() => { throw new Error('posthog down'); });
    expect(() => emitReportIssueSubmitted({ ...baseInput })).not.toThrow();
  });
});
