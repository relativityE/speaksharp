import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  collectAuthorities, comparisonRows, decodePostHogRows, geminiSessionReadback,
  postHogReadbackQuery,
} from '../../scripts/human-test/collect-model-downselection-authority.mjs';

const RELEASE = 'a'.repeat(40);
const CANDIDATES = ['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium'];
const JOURNEYS = ['open_mic', 'focus_points'];

function packet() {
  let index = 0;
  return {
    environment: { releaseSha: RELEASE },
    telemetryReadback: { positiveControlNonce: 'pc-authority-123456' },
    candidateEvidence: CANDIDATES.flatMap((candidateId) => JOURNEYS.map((journey) => {
      index += 1;
      return {
        candidateId, journey, journeyId: `journey-${index}`, controlNonce: `comparison-nonce-${index}`,
        persistedSessionId: `session-${index}`,
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
    expect(query).not.toMatch(/transcript|what_worked|what_to_try_next|distinct_id/i);
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
    ]])).toEqual([{
      uuid: 'event-1', event: 'session_saved', releaseSha: RELEASE, candidateId: 'v4:distil:q4',
      productMode: null, journeyId: 'journey-1', attemptId: 'attempt-1', attemptSeq: 1,
      wordCount: 42, controlNonce: 'comparison-nonce-1', transportInitialized: null,
    }]);
  });

  it('derives Gemini digest and word counts from persisted session readback, not packet claims', () => {
    const authority = geminiSessionReadback([{
      id: 'session-1',
      ai_suggestions: {
        version: 'gemini_coaching_v1', what_worked: 'Clear concise opening',
        what_to_try_next: 'Pause before your recommendation',
      },
    }]);
    expect(authority).toMatchObject([{
      persistedSessionId: 'session-1', whatWorkedWhitespaceWords: 3,
      whatToImproveWhitespaceWords: 4, readable: true,
    }]);
    expect(authority[0].suggestionDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(authority)).not.toMatch(/Clear concise|Pause before/);
  });

  it('queries PostHog and Supabase independently and emits no coaching content', async () => {
    const evidence = packet();
    const posthogRows = [[
      'event-control', 'telemetry_positive_control', RELEASE, null, null, 'journey-control', null,
      0, null, 'pc-authority-123456', true,
    ]];
    const sessions = evidence.candidateEvidence.map((row) => ({
      id: row.persistedSessionId,
      ai_suggestions: {
        version: 'gemini_coaching_v1', what_worked: 'Clear opening', what_to_try_next: 'Pause before closing',
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
    expect(JSON.stringify(authority)).not.toMatch(/Clear opening|Pause before closing|posthog-secret|supabase-secret/);
  });
});
