#!/usr/bin/env node

const FLAG_KEY = 'private_stt_v4_enabled';
const DISTIL_FLAG_KEY = 'private_stt_v4_distil_enabled';
const FLAG_ID = '709644';
const DEFAULT_COHORT_NAME = 'stt_ab_disposable_pro_testers';

const appUserId = requireEnv('STT_AB_APP_USER_ID');
const projectId = requireEnv('POSTHOG_PROJECT_ID');
const personalApiKey = requireEnv('POSTHOG_PERSONAL_API_KEY');
const projectApiKey = requireEnv('POSTHOG_PROJECT_API_KEY', ['VITE_POSTHOG_KEY']);
const apiHost = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
const ingestHost = (process.env.POSTHOG_INGEST_HOST || process.env.VITE_POSTHOG_HOST || apiHost).replace(/\/$/, '');
const requestedCohortId = process.env.POSTHOG_STT_AB_COHORT_ID || '';
// EXCLUSIVITY: default to a UNIQUE per-run static cohort so the proof always targets a FRESH cohort
// that contains exactly the one target user — never silently reuses a named cohort that may already
// hold other members. (Override only via POSTHOG_STT_AB_COHORT_NAME/_ID, e.g. for cleanup.)
const cohortName = process.env.POSTHOG_STT_AB_COHORT_NAME
  || `stt_ab_single_user_${String(appUserId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}_${Date.now()}`;
// NEGATIVE CONTROL: a synthetic distinct_id that is NOT the target. v4 MUST stay false for it,
// both before and after the mutation — empirical proof there is no broad/global rollout.
const controlDistinctId = `gate-b-negative-control-${Date.now()}`;

const evidence = {
  gate: 'POSTHOG-STT-A/B',
  mode: 'authenticated_user_targeting_proof',
  checkedAt: new Date().toISOString(),
  posthogEnvironmentIdSource: 'POSTHOG_PROJECT_ID',
  testUser: {
    appUserId,
  },
  identityContract: {
    queryBy: 'distinct_id',
    distinctId: appUserId,
    emailTargetingUsed: false,
    clientSettableInternalTesterUsed: false,
  },
  expectedFlag: {
    id: FLAG_ID,
    key: FLAG_KEY,
    distilKey: DISTIL_FLAG_KEY,
  },
  person: null,
  cohort: null,
  flagConfig: null,
  serverIdentity: null,
  mutations: [],
  flagEvaluationBefore: null,
  flagEvaluationAfter: null,
  controlEvaluationBefore: null,
  controlEvaluationAfter: null,
  cohortMemberCount: null,
  flagGroupsBefore: null,
  flagGroupsAfter: null,
  exclusivity: null,
  classification: null,
  pass: false,
};

try {
  evidence.person = await findPerson();
  evidence.serverIdentity = await inspectServerIdentity(evidence.person);
  evidence.flagEvaluationBefore = await evaluateFlags(appUserId);
  evidence.controlEvaluationBefore = await evaluateFlags(controlDistinctId);
  const flagBefore = await fetchFlagConfig();
  evidence.flagGroupsBefore = summarizeFlagGroups(flagBefore);

  // FAIL-CLOSED pre-check: if v4 is ALREADY on for the negative control, the flag has broad/global
  // exposure before we touch anything → abort WITHOUT mutating (do not proceed on an unsafe baseline).
  if (evidence.controlEvaluationBefore?.privateSttV4Enabled) {
    evidence.classification = 'FAIL_PREEXISTING_BROAD_EXPOSURE';
  } else if (hasBroadGroup(flagBefore)) {
    evidence.classification = 'FAIL_PREEXISTING_BROAD_FLAG_GROUP';
  }

  if (evidence.classification) {
    // pre-check failed — leave the flag untouched.
  } else if (!evidence.serverIdentity.pass) {
    evidence.classification = evidence.serverIdentity.classification;
  } else {
    evidence.cohort = await ensureCohort();
    if (!evidence.classification && evidence.cohort?.id) {
      await addPersonToCohort(evidence.cohort.id, evidence.person.id);
      evidence.cohortMemberCount = await getCohortMemberCount(evidence.cohort.id);
    }
    if (!evidence.classification) {
      evidence.flagConfig = await ensureFlagTargetsCohort(evidence.cohort?.id);
    }
    const flagAfter = await fetchFlagConfig();
    evidence.flagGroupsAfter = summarizeFlagGroups(flagAfter);
    evidence.flagEvaluationAfter = await evaluateFlags(appUserId);
    evidence.controlEvaluationAfter = await evaluateFlags(controlDistinctId);
    evidence.exclusivity = assessExclusivity(flagAfter);
    if (!evidence.classification) {
      evidence.classification = classifyFinal();
    }
  }
  evidence.pass = evidence.classification === 'TARGETING_VERIFIED';
} catch (error) {
  evidence.classification = evidence.classification || 'FAIL_HARNESS';
  evidence.error = sanitizeError(error);
}

console.log(`POSTHOG_STT_AB_AUTHENTICATED_USER_TARGETING_PROOF_EVIDENCE ${JSON.stringify(evidence)}`);
if (evidence.classification === 'FAIL_HARNESS') process.exitCode = 1;

async function findPerson() {
  const attempts = [];

  for (const params of [
    { distinct_id: appUserId },
    { search: appUserId },
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
  ];
}

async function inspectServerIdentity(personSummary) {
  const personQueryResult = await hogql(`
    SELECT p.id, p.created_at, p.properties, p.is_identified, pdi.distinct_id
    FROM persons p
    JOIN person_distinct_ids pdi ON pdi.person_id = p.id
    WHERE pdi.distinct_id = ${sqlString(appUserId)}
    LIMIT 5
  `, 'PostHog STT A/B queryable person by app user id');

  const webIdentifyResult = await hogql(`
    SELECT event, distinct_id, properties['$lib'], timestamp, properties
    FROM events
    WHERE distinct_id = ${sqlString(appUserId)}
      AND event = '$identify'
    ORDER BY timestamp DESC
    LIMIT 10
  `, 'PostHog STT A/B web identify events');

  const appUserEventsResult = await hogql(`
    SELECT event, distinct_id, properties['$lib'], timestamp, properties
    FROM events
    WHERE distinct_id = ${sqlString(appUserId)}
    ORDER BY timestamp DESC
    LIMIT 20
  `, 'PostHog STT A/B app user events');

  const queryErrors = [personQueryResult, webIdentifyResult, appUserEventsResult].filter((result) => (
    !result.ok || hasQueryErrors(result.body)
  ));
  if (queryErrors.length > 0) {
    return {
      pass: false,
      classification: 'FAIL_HARNESS',
      queryErrors: queryErrors.map((result) => ({
        status: result.status,
        ok: result.ok,
        error: summarizeQueryError(result.body),
      })),
    };
  }

  const personRows = Array.isArray(personQueryResult.body?.results) ? personQueryResult.body.results : [];
  const personSamples = personRows.map(summarizePersonRow);
  const webIdentifyRows = Array.isArray(webIdentifyResult.body?.results) ? webIdentifyResult.body.results : [];
  const appUserEventRows = Array.isArray(appUserEventsResult.body?.results) ? appUserEventsResult.body.results : [];
  const webIdentifySamples = webIdentifyRows.map(summarizeEventRow);
  const appUserEventSamples = appUserEventRows.map(summarizeEventRow);
  const hasWebIdentify = webIdentifySamples.some((event) => event.event === '$identify' && event.lib === 'web');
  const hasAnyWebEvent = appUserEventSamples.some((event) => event.lib === 'web');
  const hasEmailPersonProperty = personSamples.some((person) => person.hasEmailProperty);
  const hasEmailEventProperty = [...webIdentifySamples, ...appUserEventSamples].some((event) => event.hasEmailProperty);
  const hasEmailProperty = hasEmailPersonProperty || hasEmailEventProperty;
  const queryablePerson = personSamples.some((person) => person.distinctIdMatchesExpected);
  const personLookupAgrees = Boolean(personSummary?.found && personSummary?.hasAppUserDistinctId);
  const pass = queryablePerson && hasWebIdentify && hasAnyWebEvent && !hasEmailProperty;

  return {
    pass,
    classification: pass ? 'PASS' : 'FAIL_AUTH_POSTHOG_IDENTIFY',
    queryablePerson,
    queryBy: 'distinct_id',
    distinctIdMatchesExpected: queryablePerson,
    personLookupAgrees,
    hasWebIdentify,
    hasAnyWebEvent,
    hasEmailPersonProperty,
    hasEmailEventProperty,
    hasEmailProperty,
    emailTargetingUsed: false,
    clientSettableInternalTesterUsed: false,
    queryablePersonCount: personSamples.length,
    webIdentifyCount: webIdentifySamples.length,
    appUserEventCount: appUserEventSamples.length,
    personSamples,
    webIdentifySamples,
    appUserEventSamples,
  };
}

async function ensureCohort() {
  if (requestedCohortId) {
    return {
      id: requestedCohortId,
      name: cohortName,
      source: 'POSTHOG_STT_AB_COHORT_ID',
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
    description: `Temporary STT v4 A/B disposable Pro tester cohort (${appUserId})`,
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
  // EXCLUSIVITY gates — v4 must be ON for the target AND OFF for everyone else.
  if (!evidence.exclusivity?.controlDeniedV4After) return 'FAIL_BROAD_EXPOSURE_AFTER';
  if (!evidence.exclusivity?.noBroadGroupsAfter) return 'FAIL_BROAD_FLAG_GROUP_AFTER';
  return 'TARGETING_VERIFIED';
}

// ---- Exclusivity helpers: prove v4 reaches ONLY the designated target (single-user safety) ----

function flagGroups(flag) {
  if (Array.isArray(flag?.raw?.filters?.groups)) return flag.raw.filters.groups;
  if (Array.isArray(flag?.filters?.groups)) return flag.filters.groups;
  return [];
}

// A group is "broad" if it grants exposure (rollout_percentage > 0; unset defaults to 100) but is NOT
// scoped to a cohort/person condition — i.e. it would match users beyond our single-user cohort.
function groupIsBroad(group) {
  const rollout = group?.rollout_percentage;
  const grants = rollout == null ? true : Number(rollout) > 0;
  if (!grants) return false;
  const props = extractProperties(group);
  if (props.length === 0) return true; // rollout>0 with no conditions = global exposure
  return !props.every((p) => p?.type === 'cohort' || p?.key === 'id' || p?.key === 'cohort');
}

function hasBroadGroup(flag) {
  if (!flag?.found) return false;
  return flagGroups(flag).some(groupIsBroad);
}

function summarizeFlagGroups(flag) {
  if (!flag?.found) return { found: false, lookupForbidden: Boolean(flag?.lookupForbidden) };
  const groups = flagGroups(flag);
  return {
    found: true,
    active: flag.active ?? flag.raw?.active ?? null,
    groupCount: groups.length,
    hasBroadGroup: groups.some(groupIsBroad),
    groups: groups.map((g) => ({
      rolloutPercentage: g?.rollout_percentage ?? null,
      broad: groupIsBroad(g),
      properties: extractProperties(g).map(summarizeProperty),
    })),
  };
}

async function getCohortMemberCount(cohortId) {
  const response = await apiFetch(buildUrl(`/api/projects/${encodeURIComponent(projectId)}/cohorts/${encodeURIComponent(cohortId)}/`));
  if (!response.ok) return { ok: false, status: response.status, count: null };
  return {
    ok: true,
    count: typeof response.body?.count === 'number' ? response.body.count : null,
    isStatic: response.body?.is_static ?? null,
    note: 'PostHog computes static-cohort count asynchronously; null/stale immediately after add is expected — exclusivity is gated on the negative control + flag-group structure, not this count.',
  };
}

function assessExclusivity(flagAfter) {
  const targetGetsV4 = evidence.flagEvaluationAfter?.privateSttV4Enabled === true;
  const controlDeniedV4After = evidence.controlEvaluationAfter?.privateSttV4Enabled === false;
  const distilOff = evidence.flagEvaluationAfter?.distilEnabled === false;
  const noBroadGroupsAfter = flagAfter?.found ? !flagGroups(flagAfter).some(groupIsBroad) : false;
  return {
    targetGetsV4,
    controlDeniedV4After,
    controlDistinctId,
    distilOff,
    noBroadGroupsAfter,
    cohortMemberCount: evidence.cohortMemberCount?.count ?? null,
    pass: targetGetsV4 && controlDeniedV4After && distilOff && noBroadGroupsAfter,
  };
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
    hasEmailProperty: hasEmailProperty(person),
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
  return distinctIds.includes(appUserId) || String(person?.id || '') === appUserId || String(person?.uuid || '') === appUserId;
}

function hasEmailProperty(source) {
  const properties = safeObject(source?.properties ?? source);
  return Object.keys(properties).some(isEmailPropertyKey);
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

function summarizePersonRow(row) {
  const properties = safeObject(row?.[2]);
  const propertyKeys = Object.keys(properties).sort();
  return {
    idRedacted: redactId(row?.[0]),
    createdAt: row?.[1] ?? null,
    isIdentified: row?.[3] ?? null,
    distinctIdMatchesExpected: row?.[4] === appUserId,
    hasEmailProperty: propertyKeys.some(isEmailPropertyKey),
    propertyKeys,
  };
}

function summarizeEventRow(row) {
  const properties = safeObject(row?.[4]);
  const propertyKeys = Object.keys(properties).sort();
  return {
    event: row?.[0] ?? null,
    distinctIdMatchesExpected: row?.[1] === appUserId,
    lib: row?.[2] ?? null,
    timestamp: row?.[3] ?? null,
    hasEmailProperty: propertyKeys.some(isEmailPropertyKey),
    propertyKeys,
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
  if (keyText.includes('email')) return '<email>';
  if (Array.isArray(value)) return `<array:${value.length}>`;
  const text = String(value);
  return text.length > 16 ? `${text.slice(0, 5)}...${text.slice(-5)}` : value;
}

function isEmailPropertyKey(key) {
  return ['email', '$email', 'user_email'].includes(String(key || '').toLowerCase());
}

function redactId(value) {
  if (!value) return null;
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 6)}...${text.slice(-6)}` : text;
}

function redactUrl(url) {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    parsed.searchParams.set(key, '<redacted>');
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
