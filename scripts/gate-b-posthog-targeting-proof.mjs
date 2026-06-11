#!/usr/bin/env node

const FLAG_KEY = 'private_stt_v4_enabled';
const FLAG_ID = '709644';

const email = requireEnv('GATEB_TEST_EMAIL');
const appUserId = requireEnv('GATEB_APP_USER_ID');
const projectId = requireEnv('POSTHOG_PROJECT_ID');
const personalApiKey = requireEnv('POSTHOG_PERSONAL_API_KEY');
const projectApiKey = requireEnv('POSTHOG_PROJECT_API_KEY', ['VITE_POSTHOG_KEY']);
const apiHost = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
const ingestHost = (process.env.POSTHOG_INGEST_HOST || process.env.VITE_POSTHOG_HOST || apiHost).replace(/\/$/, '');

const evidence = {
  gate: 'POSTHOG-STT-A/B',
  checkedAt: new Date().toISOString(),
  posthogEnvironmentIdSource: 'POSTHOG_PROJECT_ID',
  testUser: {
    email,
    appUserId,
  },
  expectedFlag: {
    id: FLAG_ID,
    key: FLAG_KEY,
  },
  person: null,
  flagEvaluation: null,
  flagConfig: null,
  operatorTargeting: null,
  classification: null,
  pass: false,
};

try {
  const person = await findPersonByEmail(email);
  evidence.person = summarizePerson(person);
  evidence.flagEvaluation = await evaluateFlag(person);
  const flagConfig = await fetchFlagConfig();
  evidence.flagConfig = summarizeFlag(flagConfig);
  evidence.operatorTargeting = classifyOperatorTargeting(flagConfig, person);
  evidence.classification = classify(evidence);
  evidence.pass = evidence.classification === 'TARGETING_VERIFIED';
} catch (error) {
  evidence.classification = 'FAIL_HARNESS';
  evidence.error = sanitizeError(error);
}

console.log(`GATE_B_POSTHOG_TARGETING_EVIDENCE ${JSON.stringify(evidence)}`);
if (evidence.classification === 'FAIL_HARNESS') process.exitCode = 1;

async function findPersonByEmail(targetEmail) {
  const attempts = [];
  for (const params of [
    { email: targetEmail },
    { search: targetEmail },
  ]) {
    for (const base of [
      `/api/environments/${encodeURIComponent(projectId)}/persons/`,
      `/api/projects/${encodeURIComponent(projectId)}/persons/`,
    ]) {
      const url = buildUrl(base, params);
      const response = await apiGet(url);
      attempts.push({ path: redactUrl(url), status: response.status, ok: response.ok });
      if (!response.ok) continue;
      const results = normalizeResults(response.body);
      const match = results.find((candidate) => personHasEmail(candidate, targetEmail));
      if (match) return { ...match, __attempts: attempts };
      if (results.length === 1 && params.search) return { ...results[0], __attempts: attempts };
    }
  }

  const query = `
    SELECT id, created_at, properties, is_identified
    FROM persons
    WHERE properties.email = ${sqlString(targetEmail)}
       OR properties.Email = ${sqlString(targetEmail)}
       OR properties['$email'] = ${sqlString(targetEmail)}
    LIMIT 5
  `;
  const queryResult = await hogql(query, 'Gate B disposable Pro person lookup');
  attempts.push({ path: '/api/projects/<env>/query/', status: queryResult.status, ok: queryResult.ok, mode: 'hogql_person_lookup' });
  if (queryResult.ok) {
    const rows = Array.isArray(queryResult.body?.results) ? queryResult.body.results : [];
    const match = rows
      .map((row) => personFromHogqlRow(row))
      .find((candidate) => personHasEmail(candidate, targetEmail));
    if (match) return { ...match, __attempts: attempts };
  }
  return { __notFound: true, __attempts: attempts };
}

async function fetchFlagConfig() {
  const attempts = [];
  for (const path of [
    `/api/environments/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(FLAG_ID)}/`,
    `/api/projects/${encodeURIComponent(projectId)}/feature_flags/${encodeURIComponent(FLAG_ID)}/`,
    `/api/environments/${encodeURIComponent(projectId)}/feature_flags/`,
    `/api/projects/${encodeURIComponent(projectId)}/feature_flags/`,
  ]) {
    const url = path.endsWith('/feature_flags/')
      ? buildUrl(path, { key: FLAG_KEY })
      : buildUrl(path);
    const response = await apiGet(url);
    attempts.push({ path: redactUrl(url), status: response.status, ok: response.ok });
    if (!response.ok) continue;
    const body = response.body;
    const flag = Array.isArray(body?.results)
      ? body.results.find((candidate) => candidate?.key === FLAG_KEY || String(candidate?.id) === FLAG_ID)
      : body;
    if (flag?.key === FLAG_KEY || String(flag?.id) === FLAG_ID) return { ...flag, __attempts: attempts };
  }
  return { __notFound: true, __attempts: attempts };
}

async function evaluateFlag(person) {
  const distinctIds = [
    appUserId,
    ...(Array.isArray(person?.distinct_ids) ? person.distinct_ids : []),
    person?.uuid,
    person?.id,
  ].filter(Boolean).map(String);
  const distinctId = [...new Set(distinctIds)][0] || appUserId;
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
    distinctIdSource: distinctId === appUserId ? 'app_user_id' : 'posthog_person',
    privateSttV4Enabled: featureFlags[FLAG_KEY] === true,
    distilEnabled: featureFlags.private_stt_v4_distil_enabled === true,
    receivedFlagKeys: Object.keys(featureFlags).sort(),
  };
}

function summarizePerson(person) {
  if (!person || person.__notFound) {
    return {
      found: false,
      lookupAttempts: person?.__attempts || [],
      lookupForbidden: (person?.__attempts || []).some((attempt) => attempt.status === 403),
    };
  }
  const properties = safeObject(person.properties);
  return {
    found: true,
    id: person.id ?? null,
    uuid: person.uuid ?? null,
    distinctIdCount: Array.isArray(person.distinct_ids) ? person.distinct_ids.length : null,
    hasExpectedEmail: personHasEmail(person, email),
    isInternalTester: properties.isInternalTester ?? null,
    propertyKeys: Object.keys(properties).sort(),
    lookupAttempts: person.__attempts || [],
  };
}

function summarizeFlag(flag) {
  if (!flag || flag.__notFound) {
    return {
      found: false,
      lookupAttempts: flag?.__attempts || [],
      lookupForbidden: (flag?.__attempts || []).some((attempt) => attempt.status === 403),
    };
  }
  const groups = Array.isArray(flag.filters?.groups) ? flag.filters.groups : [];
  return {
    found: true,
    id: flag.id ?? null,
    key: flag.key ?? null,
    active: flag.active ?? null,
    groupCount: groups.length,
    groups: groups.map((group) => ({
      rolloutPercentage: group.rollout_percentage ?? null,
      properties: extractProperties(group).map(summarizeProperty),
    })),
    lookupAttempts: flag.__attempts || [],
  };
}

function classifyOperatorTargeting(flag, person) {
  if (!flag || flag.__notFound) {
    return {
      verified: false,
      reason: 'flag_config_unavailable',
      lookupForbidden: (flag?.__attempts || []).some((attempt) => attempt.status === 403),
    };
  }
  const groups = Array.isArray(flag.filters?.groups) ? flag.filters.groups : [];
  const properties = groups.flatMap((group) => extractProperties(group).map((property) => ({
    groupRolloutPercentage: group.rollout_percentage ?? null,
    ...summarizeProperty(property),
    raw: property,
  })));
  const personIds = [
    appUserId,
    person?.id,
    person?.uuid,
    ...(Array.isArray(person?.distinct_ids) ? person.distinct_ids : []),
  ].filter(Boolean).map(String);

  const exactEmailCondition = properties.some((property) => (
    ['$email', 'email', 'properties.email'].includes(String(property.key)) &&
    valueMatches(property.raw?.value, email)
  ));
  const exactUserCondition = properties.some((property) => (
    ['$distinct_id', 'distinct_id', 'id', 'person_id', 'uuid'].includes(String(property.key)) &&
    personIds.some((id) => valueMatches(property.raw?.value, id))
  ));
  const cohortCondition = properties.some((property) => property.type === 'cohort' || property.key === 'cohort');
  const internalTesterCondition = properties.some((property) => property.key === 'isInternalTester');
  const verified = exactEmailCondition || exactUserCondition || cohortCondition;

  return {
    verified,
    reason: verified
      ? 'operator_controlled_condition_present'
      : internalTesterCondition
        ? 'only_isInternalTester_condition_seen'
        : 'no_operator_controlled_condition_seen',
    exactEmailCondition,
    exactUserCondition,
    cohortCondition,
    internalTesterCondition,
    properties: properties.map(({ raw, ...property }) => property),
  };
}

function classify(current) {
  if (!current.person?.found || !current.person?.hasExpectedEmail) return 'BLOCKED_ON_TEST_USER_IDENTIFICATION';
  if (!current.flagEvaluation?.privateSttV4Enabled) return 'BLOCKED_ON_PRODUCT_TARGETING';
  if (!current.flagConfig?.found) return 'FAIL_HARNESS';
  if (!current.operatorTargeting?.verified) return 'BLOCKED_ON_PRODUCT_TARGETING';
  return 'TARGETING_VERIFIED';
}

async function apiGet(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${personalApiKey}`,
      Accept: 'application/json',
    },
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

function buildUrl(path, params = {}) {
  const url = new URL(`${apiHost}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function normalizeResults(body) {
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body)) return body;
  return [];
}

function personFromHogqlRow(row) {
  return {
    id: row?.[0] ?? null,
    created_at: row?.[1] ?? null,
    properties: safeObject(row?.[2]),
    is_identified: row?.[3] ?? null,
  };
}

function personHasEmail(person, targetEmail) {
  const properties = safeObject(person?.properties);
  const values = [person?.email, properties.email, properties.$email, properties.Email]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.includes(targetEmail.toLowerCase());
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

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function redactUrl(url) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    parsed.searchParams.set(key, key === 'email' || key === 'search' ? '<gateb-email>' : '<redacted>');
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

function sqlString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function requireEnv(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    if (process.env[key]) return process.env[key];
  }
  throw new Error(`Missing required env ${name}`);
}
