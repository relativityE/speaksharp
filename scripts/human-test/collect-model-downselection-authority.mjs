#!/usr/bin/env node
/**
 * Trusted default-branch readback for #1432.
 *
 * Candidate-branch JSON is inert input. PostHog and Supabase are queried with runner-held credentials;
 * the outputs contain only the governed event projection and content digests/counts. No transcript,
 * coaching phrase, user id, API response body, or credential is written to an artifact or stdout.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/;
const CANDIDATES = new Set(['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium']);
const JOURNEYS = new Set(['open_mic', 'focus_points']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const words = (value) => value.trim().split(/\s+/).filter(Boolean).length;
const SESSION_BINDING_VERSION = 'speaksharp.model-comparison-session-binding.v1';

export const modelComparisonSessionBindingSha256 = (controlNonce, persistedSessionId) => sha256(
  JSON.stringify([SESSION_BINDING_VERSION, controlNonce, persistedSessionId]),
);

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function comparisonRows(evidence) {
  const releaseSha = evidence?.environment?.releaseSha;
  const evidenceDocumentId = evidence?.evidenceDocumentId;
  if (!SHA40.test(releaseSha ?? '')) throw new Error('evidence releaseSha is invalid');
  if (!UUID_V4.test(evidenceDocumentId ?? '')) throw new Error('evidenceDocumentId must be a lowercase UUIDv4');
  if (!Array.isArray(evidence?.candidateEvidence) || evidence.candidateEvidence.length !== 6) {
    throw new Error('candidateEvidence must contain exactly six rows');
  }
  const cells = new Set();
  const nonces = new Set();
  const sessions = new Set();
  for (const row of evidence.candidateEvidence) {
    const cell = `${row?.candidateId}/${row?.journey}`;
    if (!CANDIDATES.has(row?.candidateId) || !JOURNEYS.has(row?.journey) || cells.has(cell)) {
      throw new Error(`candidateEvidence has invalid or duplicate cell ${cell}`);
    }
    if (typeof row.controlNonce !== 'string' || !TOKEN.test(row.controlNonce)) throw new Error(`${cell} controlNonce is invalid`);
    if (typeof row.persistedSessionId !== 'string' || !UUID_V4.test(row.persistedSessionId)) {
      throw new Error(`${cell} persistedSessionId must be a lowercase UUIDv4`);
    }
    if (nonces.has(row.controlNonce)) throw new Error(`candidateEvidence reuses control nonce ${row.controlNonce}`);
    if (sessions.has(row.persistedSessionId)) throw new Error(`candidateEvidence reuses persisted session ${row.persistedSessionId}`);
    nonces.add(row.controlNonce);
    sessions.add(row.persistedSessionId);
    cells.add(cell);
  }
  return { releaseSha, evidenceDocumentId, rows: evidence.candidateEvidence, nonces: [...nonces], sessions: [...sessions] };
}

export function postHogReadbackQuery(evidence) {
  const { releaseSha, rows, nonces } = comparisonRows(evidence);
  const journeys = [...new Set(rows.map((row) => row.journeyId))];
  const positive = evidence?.telemetryReadback?.positiveControlNonce;
  if (typeof positive !== 'string' || !TOKEN.test(positive)) throw new Error('positiveControlNonce is invalid');
  return `
SELECT
  uuid,
  event,
  properties.release_sha,
  properties.candidate_id,
  properties.mode,
  properties.journey_id,
  properties.attempt_id,
  properties.attempt_seq,
  properties.word_count,
  coalesce(properties.comparison_nonce, properties.control_nonce),
  properties.transport_initialized,
  properties.comparison_evidence_document_id,
  properties.comparison_session_binding_sha256
FROM events
WHERE properties.release_sha = ${quote(releaseSha)}
  AND event IN ('telemetry_positive_control', 'practice_mode_selected', 'session_started', 'session_saved')
  AND (
    properties.comparison_nonce IN (${nonces.map(quote).join(', ')})
    OR properties.journey_id IN (${journeys.map(quote).join(', ')})
    OR properties.control_nonce = ${quote(positive)}
  )
ORDER BY timestamp ASC, uuid ASC`.trim();
}

export function decodePostHogRows(rows) {
  if (!Array.isArray(rows)) throw new Error('PostHog response has no results array');
  return rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 13) throw new Error(`PostHog row ${index} has an unexpected shape`);
    return {
      uuid: row[0], event: row[1], releaseSha: row[2], candidateId: row[3] ?? null,
      productMode: row[1] === 'practice_mode_selected' ? (row[4] ?? null) : null,
      journeyId: row[5], attemptId: row[6] ?? null, attemptSeq: Number(row[7] ?? 0),
      wordCount: row[8] === null ? null : Number(row[8]), controlNonce: row[9] ?? null,
      transportInitialized: row[10] ?? null,
      evidenceDocumentId: row[11] ?? null,
      sessionBindingSha256: row[12] ?? null,
    };
  });
}

export function geminiSessionReadback(rows) {
  if (!Array.isArray(rows)) throw new Error('Supabase response is not an array');
  return rows.map((row, index) => {
    const value = row?.ai_suggestions;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.version !== 'gemini_coaching_v1'
      || typeof value.what_worked !== 'string' || !value.what_worked.trim()
      || typeof value.what_to_try_next !== 'string' || !value.what_to_try_next.trim()) {
      throw new Error(`persisted session ${index} has no readable coaching readback`);
    }
    const normalized = {
      version: 'gemini_coaching_v1',
      what_worked: value.what_worked.trim(),
      what_to_try_next: value.what_to_try_next.trim(),
    };
    return {
      persistedSessionId: row.id,
      suggestionDigest: sha256(JSON.stringify(normalized)),
      whatWorkedWhitespaceWords: words(normalized.what_worked),
      whatToImproveWhitespaceWords: words(normalized.what_to_try_next),
      readable: true,
    };
  });
}

async function jsonResponse(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  try { return JSON.parse(text); } catch { throw new Error(`${label} response was not JSON`); }
}

export async function collectAuthorities({ evidence, env = process.env, fetchImpl = fetch, now = new Date() }) {
  const { releaseSha, sessions } = comparisonRows(evidence);
  const query = postHogReadbackQuery(evidence);
  const apiHost = (env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
  const projectId = required(env.POSTHOG_PROJECT_ID, 'POSTHOG_PROJECT_ID');
  const posthogToken = required(env.POSTHOG_PERSONAL_API_KEY, 'POSTHOG_PERSONAL_API_KEY');
  const posthogResponse = await fetchImpl(`${apiHost}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${posthogToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  const posthogBody = await jsonResponse(posthogResponse, 'PostHog readback');
  const events = decodePostHogRows(posthogBody?.results);
  const queryId = `posthog-${sha256(query).slice(0, 32)}`;
  const telemetry = {
    source: 'posthog_decoded_readback', queryId, decodedAt: now.toISOString(),
    positiveControlNonce: evidence.telemetryReadback.positiveControlNonce, events,
  };

  const supabaseUrl = required(env.SUPABASE_URL, 'SUPABASE_URL').replace(/\/$/, '');
  const serviceRole = required(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
  const sessionFilter = `(${sessions.join(',')})`;
  const supabaseResponse = await fetchImpl(
    `${supabaseUrl}/rest/v1/sessions?select=id,ai_suggestions&id=in.${encodeURIComponent(sessionFilter)}`,
    { headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } },
  );
  const sessionRows = await jsonResponse(supabaseResponse, 'Supabase coaching readback');
  const observations = geminiSessionReadback(sessionRows);
  if (observations.length !== sessions.length
    || observations.some((row) => !sessions.includes(row.persistedSessionId))) {
    throw new Error('Supabase coaching readback did not return every exact persisted session');
  }

  return {
    telemetry: { schemaVersion: 'speaksharp.posthog-readback-authority.v1', releaseSha, readback: telemetry },
    gemini: { schemaVersion: 'speaksharp.gemini-session-readback-authority.v1', releaseSha, observations },
  };
}

async function main() {
  const evidencePath = resolve(required(process.env.EVIDENCE_PATH, 'EVIDENCE_PATH'));
  const telemetryOut = resolve(required(process.env.TELEMETRY_AUTHORITY_OUT, 'TELEMETRY_AUTHORITY_OUT'));
  const geminiOut = resolve(required(process.env.GEMINI_AUTHORITY_OUT, 'GEMINI_AUTHORITY_OUT'));
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const authority = await collectAuthorities({ evidence });
  mkdirSync(dirname(telemetryOut), { recursive: true });
  mkdirSync(dirname(geminiOut), { recursive: true });
  writeFileSync(telemetryOut, `${JSON.stringify(authority.telemetry, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(geminiOut, `${JSON.stringify(authority.gemini, null, 2)}\n`, { mode: 0o600 });
  console.log(`wrote content-safe authorities for ${authority.telemetry.releaseSha}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`HOLD: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
