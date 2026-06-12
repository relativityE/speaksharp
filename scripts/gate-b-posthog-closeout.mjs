#!/usr/bin/env node

const FLAG_KEY = 'private_stt_v4_enabled';
const DISTIL_FLAG_KEY = 'private_stt_v4_distil_enabled';
const FLAG_ID = '709644';
const DEFAULT_COHORT_NAME = 'v4_gateb_disposable_pro_testers';

const email = requireEnv('GATEB_TEST_EMAIL');
const appUserId = requireEnv('GATEB_APP_USER_ID');
const projectId = requireEnv('POSTHOG_PROJECT_ID');
const personalApiKey = requireEnv('POSTHOG_PERSONAL_API_KEY');
const projectApiKey = requireEnv('POSTHOG_PROJECT_API_KEY', ['VITE_POSTHOG_KEY']);
const apiHost = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
const ingestHost = (process.env.POSTHOG_INGEST_HOST || process.env.VITE_POSTHOG_HOST || apiHost).replace(/\/$/, '');
const requestedCohortId = process.env.POSTHOG_GATEB_COHORT_ID || '';
const cohortName = process.env.POSTHOG_GATEB_COHORT_NAME || DEFAULT_COHORT_NAME;

const evidence = {
  gate: 'POSTHOG-STT-A/B',
  mode: 'operator_targeting_closeout',
  checkedAt: new Date().toISOString(),
  posthogEnvironmentIdSource: 'POSTHOG_PROJECT_ID',
  testUser: {
    email,
    appUserId,
  },
  expectedFlag: {
    id: FLAG_ID,
    key: FLAG_KEY,
    distilKey: DISTIL_FLAG_KEY,
  },
  person: null,
  cohort: null,
  flagConfig: null,
  mutations: [],
  flagEvaluationBefore: null,
  flagEvaluationAfter: null,
  classification: null,
  pass: false,
};

try {
  evidence.person = await findPerson();
  evidence.flagEvaluationBefore = await evaluateFlags(appUserId);

  if (!evidence.person.found) {
    evidence.classification = 'BLOCKED_ON_TEST_USER_IDENTIFICATION';
  } else {
    evidence.cohort = await ensureCohort();
    if (!evidence.classification && evidence.cohort?.id) {
      await addPersonToCohort(evidence.cohort.id, evidence.person.id);
    }
    if (!evidence.classification) {
      evidence.flagConfig = await ensureFlagTargetsCohort(evidence.cohort?.id);
    }
    evidence.flagEvaluationAfter = await evaluateFlags(appUserId);
    if (!evidence.classification) {
      evidence.classification = classifyFinal();
    }
  }
  evidence.pass = evidence.classification === 'TARGETING_VERIFIED';
} catch (error) {
  evidence.classification = evidence.classification || 'FAIL_HARNESS';
  evidence.error = sanitizeError(error);
}

console.log(`GATE_B_POSTHOG_CLOSEOUT_EVIDENCE ${JSON.stringify(evidence)}`);
if (evidence.classification === 'FAIL_HARNESS') process.exitCode = 1;

async function findPerson() {
  const attempts = [];

  for (const params of [
    { distinct_id: appUserId },
    { search: appUserId },
    { email },
    { search: email },
  ]) {
    for (const base of [
      `/api/environments/${encodeURIComponent(projectId)}/persons/`,
      `/api/projects/${encodeURIComponent(projectId)}/persons/`,
    ]) {
      const url = buildUrl(base, params);
      const response = await apiFetch(url);
      attempts.push({ action: 'persons_rest_lookup', path: redactUrl(url), status: response.status, ok: response.ok });
      if (!response.ok) continue;
      const match = normalizeResults(response.body).find((candidate) => personMatches(candidate));
      if (match) return summarizePerson({ ...match, __attempts: attempts, __source: 'persons_rest_lookup' });
    }
  }

  for (const queryPlan of personHogqlPlans()) {
    const queryResult = await hogql(queryPlan.query, queryPlan.name);
    attempts.push({
      action: 'hogql_person_lookup',
      name: queryPlan.name,
      status: queryResult.status,
      ok: queryResult.ok,
      error: summarizeQueryError(queryResult.body),
    });
    if (!queryResult.ok || hasQueryErrors(queryResult.body)) continue;
    const rows = Array.isArray(queryResult.body?.results) ? queryResult.body.results : [];
    const match = rows.map(queryPlan.map).find(Boolean);
    if (match) return summarizePerson({ ...match, __attempts: attempts, __source: queryPlan.name });
  }

  return {
    found: false,
    lookupAttempts: attempts,
    lookupForbidden: attempts.some((attempt) => attempt.status === 403),
  };
}

function personHogqlPlans() {
  return [
    {
      name: 'events_by_distinct_id',
      query: `
        SELECT person_id, distinct_id, event, timestamp
        FROM events
        WHERE distinct_id = ${sqlString(appUserId)}
        ORDER BY timestamp DESC
        LIMIT 10
      `,
      map: (row) => row?.[0] ? { id: row[0], distinct_ids: [row[1]], properties: {}, is_identified: true } : null,
    },
    {
      name: 'person_distinct_ids_join',
      query: `
        SELECT p.id, p.created_at, p.properties, p.is_identified, pdi.distinct_id
        FROM persons p
        JOIN person_distinct_ids pdi ON pdi.person_id = p.id
        WHERE pdi.distinct_id = ${sqlString(appUserId)}
        LIMIT 5
      `,
      map: (row) => row?.[0] ? {
        id: row[0],
        created_at: row[1],
        properties: safeObject(row[2]),
        is_identified: row[3],
        distinct_ids: [row[4]],
      } : null,
    },
    {
      name: 'persons_email_fallback',
      query: `
        SELECT id, created_at, properties, is_identified
        FROM persons
        WHERE properties.email = ${sqlString(email)}
           OR properties.Email = ${sqlString(email)}
           OR properties['$email'] = ${sqlString(email)}
        LIMIT 5
      `,
      map: (row) => row?.[0] ? { id: row[0], created_at: row[1], properties: safeObject(row[2]), is_identified: row[3] } : null,
    },
  ];
}

async function ensureCohort() {
  if (requestedCohortId) {
    return {
      id: requestedCohortId,
      name: cohortName,
      source: 'POSTHOG_GATEB_COHORT_ID',
      created: false,
      lookupAttempts: [],
    };
  }

  const existing = await findCohortByName();
  if (existing.found) return existing;
  if (existing.lookupForbidden) {
    evidence.classification = 'BLOCKED_ON_POSTHOG_WRITE_SCOPE';
    return existing;
  }

  const createBody = {
    name: cohortName,
    description: `Temporary Gate B disposable Pro tester cohort (${appUserId})`,
    is_static: true,
    groups: [],
  };
  const response = await apiFetch(buildUrl(`/api/projects/${encodeURIComponent(projectId)}/cohorts/`), {
    method: 'POST',
    body: createBody,
  });
  evidence.mutations.push({
    action: 'create_static_cohort',
    status: response.status,
    ok: response.ok,
    bodySummary: summarizeBody(response.body),
  });
  if (response.status === 403) {
    evidence.classification = 'BLOCKED_ON_POSTHOG_WRITE_SCOPE';
    return { found: false, created: false, id: null, name: cohortName, createStatus: response.status };
  }
  if (!response.ok || !response.body?.id) {
    evidence.classification = 'BLOCKED_ON_POSTHOG_CONFIG_ID';
    return { found: false, created: false, id: null, name: cohortName, createStatus: response.status };
  }
  return {
    found: true,
    created: true,
    id: String(response.body.id),
    name: response.body.name || cohortName,
    source: 'created_static_cohort',
  };
}

async function findCohortByName() {
  const attempts = [];
  for (const base of [
    `/api/environments/${encodeURIComponent(projectId)}/cohorts/`,
    `/api/projects/${encodeURIComponent(projectId)}/cohorts/`,
  ]) {
    const url = buildUrl(base, { search: cohortName });
    const response = await apiFetch(url);
    attempts.push({ action: 'cohort_lookup', path: redactUrl(url), status: response.status, ok: response.ok });
    if (!response.ok) continue;
    const match = normalizeResults(response.body).find((cohort) => String(cohort?.name || '') === cohortName);
    if (match) {
      return {
        found: true,
        created: false,
        id: String(match.id),
        name: match.name,
        isStatic: match.is_static ?? null,
        source: 'cohort_lookup',
        lookupAttempts: attempts,
      };
    }
  }
  return {
    found: false,
    id: null,
    name: cohortName,
    lookupAttempts: attempts,
    lookupForbidden: attempts.some((attempt) => attempt.status === 403),
  };
}

async function addPersonToCohort(cohortId, personId) {
  const response = await apiFetch(
    buildUrl(`/api/projects/${encodeURIComponent(projectId)}/cohorts/${encodeURIComponent(cohortId)}/add_persons_to_static_cohort/`),
    {
      method: 'PATCH',
      body: { person_ids: [personId] },
    },
  );
  evidence.mutations.push({
    action: 'add_persons_to_static_cohort',
    cohortId,
    personId: redactId(personId),
    status: response.status,
    ok: response.ok,
    bodySummary: summarizeBody(response.body),
  });
  if (response.status === 403) evidence.classification = 'BLOCKED_ON_POSTHOG_WRITE_SCOPE';
  else if (!response.ok) evidence.classification = 'BLOCKED_ON_POSTHOG_CONFIG_ID';
}

async function ensureFlagTargetsCohort(cohortId) {
  if (!cohortId) {
    evidence.classification = evidence.classification || 'BLOCKED_ON_POSTHOG_CONFIG_ID';
    return { found: false, reason: 'missing_cohort_id' };
  }

  const flag = await fetchFlagConfig();
  if (!flag.found) {
    evidence.classification = flag.lookupForbidden ? 'BLOCKED_ON_POSTHOG_WRITE_SCOPE' : 'BLOCKED_ON_POSTHOG_CONFIG_ID';
    return flag;
  }

  const currentGroups = Array.isArray(flag.raw.filters?.groups) ? flag.raw.filters.groups : [];
  if (flagHasCohort(currentGroups, cohortId)) {
    return { ...flag, alreadyTargeted: true };
  }

  const nextFilters = {
    ...safeObject(flag.raw.filters),
    groups: [
      ...currentGroups,
      {
        properties: [{ key: 'id', value: Number.isFinite(Number(cohortId)) ? Number(cohortId) : cohortId, type: 'cohort' }],
        rollout_percentage: 100,
      },
    ],
  };
  const response = await apiFetch(buildUrl(`/api/projects/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(flag.id)}/`), {
    method: 'PATCH',
    body: { filters: nextFilters },
  });
  evidence.mutations.push({
    action: 'patch_feature_flag_add_cohort',
    flagId: flag.id,
    cohortId,
    status: response.status,
    ok: response.ok,
    bodySummary: summarizeBody(response.body),
  });
  if (response.status === 403) {
    evidence.classification = 'BLOCKED_ON_POSTHOG_WRITE_SCOPE';
    return { ...flag, patched: false };
  }
  if (!response.ok) {
    evidence.classification = 'BLOCKED_ON_POSTHOG_CONFIG_ID';
    return { ...flag, patched: false };
  }
  return summarizeFlag(response.body, flag.lookupAttempts, { patched: true });
}

async function fetchFlagConfig() {
  const attempts = [];
  for (const path of [
    `/api/environments/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(FLAG_ID)}/`,
    `/api/projects/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(FLAG_ID)}/`,
    `/api/environments/${encodeURIComponent(projectId)}/feature_flags/`,
    `/api/projects/${encodeURIComponent(projectId)}/feature_flags/`,
  ]) {
    const url = path.endsWith('/feature_flags/') ? buildUrl(path, { key: FLAG_KEY }) : buildUrl(path);
    const response = await apiFetch(url);
    attempts.push({ action: 'flag_config_lookup', path: redactUrl(url), status: response.status, ok: response.ok });
    if (!response.ok) continue;
    const body = response.body;
    const flag = Array.isArray(body?.results)
      ? body.results.find((candidate) => candidate?.key === FLAG_KEY || String(candidate?.id) === FLAG_ID)
      : body;
    if (flag?.key === FLAG_KEY || String(flag?.id) === FLAG_ID) return summarizeFlag(flag, attempts);
  }
  return {
    found: false,
    lookupAttempts: attempts,
    lookupForbidden: attempts.some((attempt) => attempt.status === 403),
  };
}

async function evaluateFlags(distinctId) {
  const response = await fetch(`${ingestHost}/decide/?v=3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: projectApiKey,
      distinct_id: distinctId,
    }),
  });
  const body = await parseBody(response);
  const featureFlags = body?.featureFlags && typeof body.featureFlags === 'object' ? body.featureFlags : {};
  return {
    status: response.status,
    ok: response.ok,
    distinctId: redactId(distinctId),
    privateSttV4Enabled: featureFlags[FLAG_KEY] === true,
    distilEnabled: featureFlags[DISTIL_FLAG_KEY] === true,
    receivedFlagKeys: Object.keys(featureFlags).sort(),
  };
}

function classifyFinal() {
  if (!evidence.person?.found) return 'BLOCKED_ON_TEST_USER_IDENTIFICATION';
  if (evidence.classification) return evidence.classification;
  if (!evidence.flagEvaluationAfter?.privateSttV4Enabled) return 'FAIL_FLAG_TARGETING_CONFIG';
  if (evidence.flagEvaluationAfter?.distilEnabled) return 'FAIL_FLAG_TARGETING_CONFIG';
  return 'TARGETING_VERIFIED';
}

function summarizePerson(person) {
  const properties = safeObject(person.properties);
  const distinctIds = Array.isArray(person.distinct_ids) ? person.distinct_ids.map(String) : [];
  return {
    found: true,
    id: person.id ?? null,
    idRedacted: redactId(person.id),
    uuid: person.uuid ?? null,
    distinctIdCount: distinctIds.length || null,
    hasAppUserDistinctId: distinctIds.includes(appUserId),
    hasExpectedEmail: personHasEmail(person),
    isIdentified: person.is_identified ?? null,
    propertyKeys: Object.keys(properties).sort(),
    lookupSource: person.__source ?? null,
    lookupAttempts: person.__attempts || [],
  };
}

function summarizeFlag(flag, attempts = [], extra = {}) {
  const groups = Array.isArray(flag?.filters?.groups) ? flag.filters.groups : [];
  return {
    found: true,
    id: String(flag.id),
    key: flag.key,
    active: flag.active ?? null,
    groupCount: groups.length,
    cohortTargeted: groups.some((group) => extractProperties(group).some((property) => property.type === 'cohort' || property.key === 'cohort')),
    groups: groups.map((group) => ({
      rolloutPercentage: group.rollout_percentage ?? null,
      properties: extractProperties(group).map(summarizeProperty),
    })),
    lookupAttempts: attempts,
    raw: flag,
    ...extra,
  };
}

function flagHasCohort(groups, cohortId) {
  return groups.some((group) => extractProperties(group).some((property) => (
    (property?.type === 'cohort' || property?.key === 'cohort' || property?.key === 'id') &&
    valueMatches(property?.value, cohortId)
  )));
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${personalApiKey}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await parseBody(response),
  };
}

async function hogql(query, name) {
  const response = await fetch(`${apiHost}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${personalApiKey}`,
    },
    body: JSON.stringify({
      query: {
        kind: 'HogQLQuery',
        query,
      },
      name,
    }),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await parseBody(response),
  };
}

async function parseBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function normalizeResults(body) {
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body)) return body;
  return [];
}

function personMatches(person) {
  const distinctIds = Array.isArray(person?.distinct_ids) ? person.distinct_ids.map(String) : [];
  return distinctIds.includes(appUserId) || String(person?.id || '') === appUserId || String(person?.uuid || '') === appUserId || personHasEmail(person);
}

function personHasEmail(person) {
  const properties = safeObject(person?.properties);
  const values = [person?.email, properties.email, properties.$email, properties.Email]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.includes(email.toLowerCase());
}

function extractProperties(group) {
  return [
    ...(Array.isArray(group?.properties) ? group.properties : []),
    ...(Array.isArray(group?.filters?.properties) ? group.filters.properties : []),
  ];
}

function summarizeProperty(property) {
  return {
    key: property?.key ?? null,
    type: property?.type ?? null,
    operator: property?.operator ?? null,
    value: redactValue(property?.key, property?.value),
  };
}

function summarizeBody(body) {
  if (!body || typeof body !== 'object') return body == null ? null : '<non-object>';
  return {
    id: body.id ?? null,
    key: body.key ?? null,
    name: body.name ?? null,
    detail: typeof body.detail === 'string' ? body.detail.slice(0, 160) : undefined,
    error: typeof body.error === 'string' ? body.error.slice(0, 160) : undefined,
    raw: typeof body.raw === 'string' ? body.raw.slice(0, 160) : undefined,
  };
}

function summarizeQueryError(body) {
  if (!hasQueryErrors(body)) return null;
  return JSON.stringify(body.errors || body.error || body.detail || body).slice(0, 240);
}

function hasQueryErrors(body) {
  return Boolean(body?.errors || body?.error || (typeof body?.detail === 'string' && body.detail.toLowerCase().includes('error')));
}

function buildUrl(path, params = {}) {
  const url = new URL(`${apiHost}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function valueMatches(actual, expected) {
  if (actual == null || expected == null) return false;
  if (Array.isArray(actual)) return actual.map(String).includes(String(expected));
  return String(actual) === String(expected);
}

function redactValue(key, value) {
  if (value == null) return null;
  const keyText = String(key || '').toLowerCase();
  if (keyText.includes('email')) return valueMatches(value, email) ? '<gateb-email>' : '<email>';
  if (Array.isArray(value)) return `<array:${value.length}>`;
  const text = String(value);
  return text.length > 16 ? `${text.slice(0, 5)}...${text.slice(-5)}` : value;
}

function redactId(value) {
  if (!value) return null;
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 6)}...${text.slice(-6)}` : text;
}

function redactUrl(url) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    parsed.searchParams.set(key, ['email', 'search', 'distinct_id', 'key'].includes(key) ? '<redacted>' : '<redacted>');
  }
  return `${parsed.pathname}${parsed.search}`;
}

function sanitizeError(error) {
  return {
    name: error?.name ?? 'Error',
    message: String(error?.message ?? error)
      .replaceAll(personalApiKey, '<redacted>')
      .replaceAll(projectApiKey, '<redacted>'),
  };
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sqlString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function requireEnv(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    if (process.env[key]) return process.env[key];
  }
  throw new Error(`Missing required env ${name}`);
}
