import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  collectAuthorities, comparisonRows, decodePostHogRows, geminiSessionReadback,
  modelComparisonSessionBindingSha256, postHogReadbackQuery,
} from '../../scripts/human-test/collect-model-downselection-authority.mjs';

const RELEASE = 'a'.repeat(40);
const CANDIDATES = ['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium'];
const JOURNEYS = ['open_mic', 'focus_points'];
const EVIDENCE_DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

function packet() {
  let index = 0;
  return {
    evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
    environment: { releaseSha: RELEASE },
    telemetryReadback: { positiveControlNonce: 'pc-authority-123456' },
    candidateEvidence: CANDIDATES.flatMap((candidateId) => JOURNEYS.map((journey) => {
      index += 1;
      return {
        candidateId, journey, journeyId: `journey-${index}`, controlNonce: `comparison-nonce-${index}`,
        persistedSessionId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      };
    })),
  };
}

const response = (value, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(value),
});

describe('#1432 trusted model-downselection authority collector', () => {
  it('pins trusted default-branch collection and verifies both attestations before parsing', () => {
    const workflow = readFileSync('.github/workflows/model-downselection-authority.yml', 'utf8');
    expect(workflow).toContain("github.ref == format('refs/heads/{0}', github.event.repository.default_branch)");
    expect(workflow).toMatch(/id-token:\s*write/);
    expect(workflow).toMatch(/attestations:\s*write/);
    expect(workflow).toMatch(/artifact-metadata:\s*write/);
    expect(workflow).toContain('uses: actions/attest@v4');
    expect(workflow).toContain('subject-path: artifacts/*.json');

    const validator = readFileSync('scripts/human-test/validate-model-downselection.mjs', 'utf8');
    expect(validator.match(/'attestation', 'verify'/g)).toHaveLength(1);
    expect(validator).toContain('for (const path of [telemetryAuthorityFile, geminiAuthorityFile])');
    expect(validator.indexOf("'attestation', 'verify'")).toBeLessThan(
      validator.indexOf('JSON.parse(await readFile(telemetryAuthorityFile'),
    );
  });

  it('registers the temporary Production verification key in the executable env catalog', () => {
    const optional = readFileSync('env.optional', 'utf8').split(/\r?\n/)
      .map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    expect(optional).toContain('VITE_MODEL_COMPARISON_PUBLIC_KEY');
  });

  it('builds one bounded PostHog query from six unique signed rows', () => {
    const query = postHogReadbackQuery(packet());
    expect(query).toContain(`properties.release_sha = '${RELEASE}'`);
    for (let index = 1; index <= 6; index += 1) {
      expect(query).toContain(`'comparison-nonce-${index}'`);
      expect(query).toContain(`'journey-${index}'`);
    }
    expect(query).toContain("properties.control_nonce = 'pc-authority-123456'");
    expect(query).toContain('properties.comparison_evidence_document_id');
    expect(query).toContain('properties.comparison_session_binding_sha256');
    expect(query).not.toMatch(/transcript|what_worked|what_to_try_next|distinct_id/i);
  });

  it('pins the byte-exact session-binding digest shared with the browser', () => {
    expect(modelComparisonSessionBindingSha256(
      'binding-vector-123456', '22222222-2222-4222-8222-222222222222',
    )).toBe('79fb824b7746e990fce8913b12e004b18ea1f706ff69722a3da91fb25289e478');
  });

  it('refuses duplicate control nonces before querying either provider', () => {
    const evidence = packet();
    evidence.candidateEvidence[1].controlNonce = evidence.candidateEvidence[0].controlNonce;
    expect(() => comparisonRows(evidence)).toThrow(/reuses control nonce/);
  });

  it('decodes only the governed content-free PostHog projection', () => {
    expect(decodePostHogRows([[
      'event-1', 'session_saved', RELEASE, 'v4:distil:q4', 'private', 'journey-1',
      'attempt-1', 1, 42, 'comparison-nonce-1', null,
      EVIDENCE_DOCUMENT_ID,
      modelComparisonSessionBindingSha256('comparison-nonce-1', '00000000-0000-4000-8000-000000000001'),
    ]])).toEqual([{
      uuid: 'event-1', event: 'session_saved', releaseSha: RELEASE, candidateId: 'v4:distil:q4',
      productMode: null, journeyId: 'journey-1', attemptId: 'attempt-1', attemptSeq: 1,
      wordCount: 42, controlNonce: 'comparison-nonce-1', transportInitialized: null,
      evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
      sessionBindingSha256: modelComparisonSessionBindingSha256(
        'comparison-nonce-1', '00000000-0000-4000-8000-000000000001',
      ),
    }]);
  });

  it('derives Gemini digest and word counts from persisted session readback, not packet claims', () => {
    const authority = geminiSessionReadback([{
      id: 'session-1',
      user_id: '22222222-2222-4222-8222-222222222222',
      ai_suggestions: {
        version: 'gemini_coaching_v1', what_worked: 'Clear concise opening',
        what_to_try_next: 'Pause before your recommendation',
      },
      ai_suggestion_authority_receipts: {
        provider: 'google_gemini', model: 'gemini-3-flash-preview', provider_request_made: true,
        quota_scope: 'user_utc_day', quota_utc_date: '2026-09-10', quota_limit: 20,
        quota_request_number: 1, cache_read_count: 1,
      },
    }]);
    expect(authority).toMatchObject([{
      persistedSessionId: 'session-1', whatWorkedWhitespaceWords: 3,
      whatToImproveWhitespaceWords: 4, readable: true,
      provider: 'google_gemini', model: 'gemini-3-flash-preview', providerRequestMade: true,
      quota: { scope: 'user_utc_day', utcDate: '2026-09-10', limit: 20, requestNumber: 1 },
      cacheReplayObserved: true,
    }]);
    expect(authority[0].suggestionDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(authority)).not.toMatch(/Clear concise|Pause before/);
  });

  it('refuses persisted coaching without its server-owned authority receipt', () => {
    expect(() => geminiSessionReadback([{
      id: 'session-1',
      user_id: '22222222-2222-4222-8222-222222222222',
      ai_suggestions: {
        version: 'gemini_coaching_v1', what_worked: 'Clear concise opening',
        what_to_try_next: 'Pause before your recommendation',
      },
      ai_suggestion_authority_receipts: null,
    }])).toThrow(/no valid server-owned Gemini authority receipt/);
  });

  it('queries PostHog and Supabase independently and emits no coaching content', async () => {
    const evidence = packet();
    const posthogRows = [[
      'event-control', 'telemetry_positive_control', RELEASE, null, null, 'journey-control', null,
      0, null, 'pc-authority-123456', true,
      null, null,
    ]];
    const sessions = evidence.candidateEvidence.map((row, index) => ({
      id: row.persistedSessionId,
      user_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      ai_suggestions: {
        version: 'gemini_coaching_v1', what_worked: 'Clear opening', what_to_try_next: 'Pause before closing',
      },
      ai_suggestion_authority_receipts: {
        provider: 'google_gemini', model: 'gemini-3-flash-preview', provider_request_made: true,
        quota_scope: 'user_utc_day', quota_utc_date: '2026-09-10', quota_limit: 20,
        quota_request_number: index + 1, cache_read_count: index === 0 ? 1 : 0,
      },
    }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ results: posthogRows }))
      .mockResolvedValueOnce(response(sessions));

    const authority = await collectAuthorities({
      evidence,
      fetchImpl,
      now: new Date('2026-09-10T12:00:00.000Z'),
      env: {
        POSTHOG_API_HOST: 'https://us.posthog.com', POSTHOG_PROJECT_ID: 'project',
        POSTHOG_PERSONAL_API_KEY: 'posthog-secret', SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'supabase-secret',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer posthog-secret');
    expect(fetchImpl.mock.calls[1][1].headers.apikey).toBe('supabase-secret');
    expect(authority.telemetry).toMatchObject({
      schemaVersion: 'speaksharp.posthog-readback-authority.v1', releaseSha: RELEASE,
    });
    expect(authority.gemini.observations).toHaveLength(6);
    expect(authority.gemini.observations[0]).toMatchObject({
      provider: 'google_gemini', model: 'gemini-3-flash-preview', providerRequestMade: true,
      quota: { scope: 'user_utc_day', utcDate: '2026-09-10', limit: 20, requestNumber: 1 },
      cacheReplayObserved: true,
    });
    expect(JSON.stringify(authority)).not.toMatch(/Clear opening|Pause before closing|posthog-secret|supabase-secret/);
  });
});
