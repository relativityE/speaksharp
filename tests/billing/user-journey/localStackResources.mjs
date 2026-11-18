// This run's disposable Supabase stack: record exactly what it created, then prove exactly that is gone.
// No network, no secrets, no provider content. Docker is reached only through the injected `docker` runner,
// so every rule here is tested offline against a fake.
//
// Sam's #1813 return on 230ae21b:
//  (a) every Docker query is checked on its own; a failed query is an error, never an empty answer;
//  (b) an empty selector after stop is not proof. The identities are captured after creation and each one
//      must be absent after a checked stop; a selector that matched the wrong thing (or nothing) fails.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const IDENTITY_SCHEMA = 'billing-local-stack-identity/v1';
export const DESTROYED_SCHEMA = 'billing-local-stack-destroyed/v2';
export const PROJECT_PATTERN = /^billing-local-stack-[0-9]{1,20}-[0-9]{1,6}$/;
const LABEL = 'com.supabase.cli.project';
const KINDS = /** @type {const} */ (['container', 'volume', 'network']);
const LIST = {
  container: (filter) => ['ps', '-aq', '--no-trunc', '--filter', filter],
  volume: (filter) => ['volume', 'ls', '-q', '--filter', filter],
  network: (filter) => ['network', 'ls', '-q', '--no-trunc', '--filter', filter],
};
const NOT_FOUND = { container: /no such (container|object)/i, volume: /no such volume|volume .* not found/i,
  network: /no such network|network .* not found/i };

export class StackProofError extends Error {
  constructor(code) { super(`LOCAL_STACK:${code}`); this.code = code; }
}
const fail = (code) => { throw new StackProofError(code); };

/** Default runner: never throws, always reports the exit code, so callers decide. */
export function runDocker(args) {
  try {
    const stdout = execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: typeof error?.status === 'number' ? error.status : 1, stdout: `${error?.stdout ?? ''}`,
      stderr: `${error?.stderr ?? ''}` };
  }
}

/** One Docker list query, checked on its own: a non-zero exit or unreadable answer is an error. */
function list(docker, kind, filter) {
  const answer = docker(LIST[kind](filter));
  if (!answer || answer.code !== 0) fail(`${kind}_query_failed:${filter.split('=')[0]}`);
  const ids = `${answer.stdout ?? ''}`.split('\n').map(line => line.trim()).filter(Boolean);
  if (ids.some(id => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id))) fail(`${kind}_query_unreadable`);
  return [...new Set(ids)].sort();
}

function selectors(project) {
  return { label: `label=${LABEL}=${project}`, name: `name=_${project}` };
}

function requireProject(project) {
  if (typeof project !== 'string' || !PROJECT_PATTERN.test(project)) fail('project_invalid');
}

/**
 * After `supabase start`: what this run created. Each kind is read by label and by name, independently
 * checked, and the two selectors must agree and be non-empty. Every container must carry this run's label,
 * the database container and its data volume must be among them, and the database must answer with its
 * own system identifier, so a selector pointing at the wrong thing, or at nothing, fails here.
 */
export function captureStackIdentity(project, docker = runDocker) {
  requireProject(project);
  const { label, name } = selectors(project);
  /** @type {Record<string, string[]>} */
  const found = {};
  for (const kind of KINDS) {
    const byLabel = list(docker, kind, label);
    const byName = list(docker, kind, name);
    if (byLabel.length === 0) fail(`${kind}_selector_matched_nothing`);
    if (byLabel.join(',') !== byName.join(',')) fail(`${kind}_selectors_disagree`);
    found[kind] = byLabel;
  }
  const dbName = `supabase_db_${project}`;
  const db = docker(['container', 'inspect', '--format', `{{.Id}} {{.Name}} {{index .Config.Labels "${LABEL}"}}`, dbName]);
  if (!db || db.code !== 0) fail('database_container_unreadable');
  const [dbId, dbContainerName, dbLabel] = `${db.stdout}`.trim().split(/\s+/);
  if (dbContainerName !== `/${dbName}` || dbLabel !== project) fail('database_container_not_this_run');
  if (!found.container.includes(dbId)) fail('database_container_not_captured');
  for (const id of found.container) {
    const owner = docker(['container', 'inspect', '--format', `{{index .Config.Labels "${LABEL}"}}`, id]);
    if (!owner || owner.code !== 0) fail('container_unreadable');
    if (`${owner.stdout}`.trim() !== project) fail('container_not_this_run');
  }
  if (!found.volume.includes(`supabase_db_${project}`)) fail('database_volume_not_captured');
  const sysid = docker(['exec', dbName, 'psql', '-U', 'postgres', '-tAc', 'select system_identifier from pg_control_system()']);
  if (!sysid || sysid.code !== 0) fail('database_identity_unreadable');
  const systemIdentifier = `${sysid.stdout}`.trim();
  if (!/^[0-9]{1,20}$/.test(systemIdentifier)) fail('database_identity_unreadable');
  return { schema: IDENTITY_SCHEMA, project, database: { container: dbId, volume: `supabase_db_${project}`, systemIdentifier },
    containers: found.container, volumes: found.volume, networks: found.network };
}

export function assertIdentityShape(identity, project) {
  requireProject(project);
  const keys = ['schema', 'project', 'database', 'containers', 'volumes', 'networks'];
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) fail('identity_missing');
  if (Object.keys(identity).sort().join(',') !== [...keys].sort().join(',')) fail('identity_shape');
  if (identity.schema !== IDENTITY_SCHEMA || identity.project !== project) fail('identity_not_this_run');
  for (const field of ['containers', 'volumes', 'networks']) {
    const ids = identity[field];
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string' || !id)) fail(`identity_${field}`);
  }
  const db = identity.database;
  if (!db || typeof db !== 'object' || !identity.containers.includes(db.container)
    || db.volume !== `supabase_db_${project}` || !identity.volumes.includes(db.volume)
    || !/^[0-9]{1,20}$/.test(`${db.systemIdentifier ?? ''}`)) fail('identity_database');
}

/**
 * The sha256 of this run's captured identity list, in a canonical form (fixed key order, sorted id lists), so
 * the same capture always gives the same digest however the file was formatted (Sam's 6cd45e76 cleanup review:
 * keep the captured baseline as evidence and hash it). The identity must be this project's, well formed.
 */
export function stackIdentitySha256(identity, project) {
  assertIdentityShape(identity, project);
  const canonical = {
    schema: identity.schema, project: identity.project,
    database: { container: identity.database.container, volume: identity.database.volume,
      systemIdentifier: `${identity.database.systemIdentifier}` },
    containers: [...identity.containers].sort(), volumes: [...identity.volumes].sort(), networks: [...identity.networks].sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * After a CHECKED `supabase stop`: each captured identity must be gone. Absence is only accepted as Docker's
 * own "no such ..." answer; an inspect that succeeds means it remains, any other error means unverified.
 * The selectors are also re-read, each checked on its own, and must be empty.
 */
export function verifyStackDestroyed(identity, project, docker = runDocker) {
  assertIdentityShape(identity, project);
  const ids = { container: identity.containers, volume: identity.volumes, network: identity.networks };
  for (const kind of KINDS) {
    for (const id of ids[kind]) {
      const answer = docker([kind, 'inspect', id]);
      if (answer && answer.code === 0) fail(`${kind}_remains`);
      if (!answer || !NOT_FOUND[kind].test(`${answer.stderr ?? ''}`)) fail(`${kind}_absence_unverified`);
    }
    const { label, name } = selectors(project);
    for (const filter of [label, name]) {
      if (list(docker, kind, filter).length > 0) fail(`${kind}_remains`);
    }
  }
  // The proof names the exact baseline it was checked against, so it cannot be paired with another list.
  return { schema: DESTROYED_SCHEMA, project, databaseSystemIdentifier: identity.database.systemIdentifier,
    identitySha256: stackIdentitySha256(identity, project),
    containers: identity.containers.length, volumes: identity.volumes.length, networks: identity.networks.length, destroyed: true };
}

export const WITNESS_SCHEMA = 'billing-local-stack-cleanup-witness/v1';
// The run's one synthetic owner (journey.billing.spec.ts `marker`@example.com). Never printed.
const OWNER_EMAIL = '^rwt-journey-billing-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\\.com$';
const OWNER_SQL = `SELECT count(*) || '|' || count(*) FILTER (WHERE email ~ '${OWNER_EMAIL}') FROM auth.users`;
// Counts only, for that one owner. An admitted obligation is split by what can settle it: linked to a session, or
// lease-only and either still the current lease or a superseded one (no lease row carries its lease_id).
const COUNTS_SQL = `WITH o AS (SELECT id FROM auth.users WHERE email ~ '${OWNER_EMAIL}'),
cur AS (SELECT lease_id, state FROM public.active_recording_lease WHERE user_id IN (SELECT id FROM o)),
rows AS (
  SELECT 'obligation' AS kind, phase AS k, CASE WHEN session_id IS NOT NULL THEN 'session_linked'
    WHEN lease_id IN (SELECT lease_id FROM cur) THEN 'lease_only_current' ELSE 'lease_only_superseded' END AS b
    FROM public.account_save_obligations WHERE user_id IN (SELECT id FROM o)
  UNION ALL SELECT 'lease', state, '-' FROM cur
  UNION ALL SELECT 'session', status, CASE WHEN lease_id IS NULL THEN 'unleased' ELSE 'lease_linked' END
    FROM public.sessions WHERE user_id IN (SELECT id FROM o))
SELECT kind || '|' || k || '|' || b || '|' || count(*) FROM rows GROUP BY kind, k, b ORDER BY kind, k, b`;
const COUNT_ROW = /^(obligation|lease|session)\|([a-z_]{1,32})\|(session_linked|lease_only_current|lease_only_superseded|-|unleased|lease_linked)\|([0-9]{1,9})$/;
// Allowlisted failure categories: the only thing read from logs is how many lines contain each fixed phrase.
const CATEGORIES = { guard_admitted_save_unsettled: 'account admitted save unsettled', auth_database_error_deleting_user: 'Database error deleting user' };

/** Full answer for logs (a container writes its log to both streams); never throws. */
export function runDockerFull(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: typeof r.status === 'number' ? r.status : 1, stdout: `${r.stdout ?? ''}`, stderr: `${r.stderr ?? ''}` };
}

/** The recorded container for `supabase_<service>_<project>`: same id, same name, this run's label, or a failure. */
function recordedContainer(docker, identity, project, service) {
  const name = `supabase_${service}_${project}`;
  const answer = docker(['container', 'inspect', '--format', `{{.Id}} {{.Name}} {{index .Config.Labels "${LABEL}"}}`, name]);
  if (!answer || answer.code !== 0) fail(`witness_${service}_container_unreadable`);
  const [id, containerName, label] = `${answer.stdout}`.trim().split(/\s+/);
  if (containerName !== `/${name}` || label !== project || !identity.containers.includes(id)) fail(`witness_${service}_container_not_recorded`);
  return id;
}

function psql(docker, container, sql) {
  const answer = docker(['exec', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', sql]);
  if (!answer || answer.code !== 0) fail('witness_query_failed');
  return `${answer.stdout}`.split('\n').map(line => line.trim()).filter(Boolean);
}

/**
 * Sam's 18 Nov ask on #1898, before teardown and only after an Auth-refused cleanup: prove this is the exact recorded
 * database (container id and system identifier) and that it holds exactly one user, the run's synthetic owner; then
 * return only bounded counts for that owner and how often each allowlisted failure phrase appeared in the Auth and
 * database logs. No ids, emails, rows or log lines leave this function; anything unexpected is a failure code.
 */
export function witnessCleanupRefusal(identity, project, docker = runDockerFull) {
  assertIdentityShape(identity, project);
  const db = recordedContainer(docker, identity, project, 'db');
  if (db !== identity.database.container) fail('witness_database_not_recorded');
  const [sysid] = psql(docker, db, 'select system_identifier from pg_control_system()');
  if (sysid !== `${identity.database.systemIdentifier}`) fail('witness_database_identity_mismatch');
  const [owners] = psql(docker, db, OWNER_SQL);
  if (owners !== '1|1') fail('witness_owner_unbound');
  const counts = { obligation: {}, lease: {}, session: {} };
  for (const line of psql(docker, db, COUNTS_SQL)) {
    const m = COUNT_ROW.exec(line);
    if (!m) fail('witness_count_unreadable');
    const key = m[3] === '-' ? m[2] : `${m[2]}:${m[3]}`;
    counts[m[1]][key] = Number(m[4]);
  }
  const auth = recordedContainer(docker, identity, project, 'auth');
  const failureCategories = {};
  for (const [source, container] of [['auth', auth], ['db', db]]) {
    const answer = docker(['logs', container]);
    if (!answer || answer.code !== 0) fail(`witness_${source}_logs_unreadable`);
    const lines = `${answer.stdout}\n${answer.stderr}`.split('\n');
    for (const [category, phrase] of Object.entries(CATEGORIES)) {
      const n = lines.filter(line => line.includes(phrase)).length;
      if (n > 0) failureCategories[`${source}:${category}`] = n;
    }
  }
  return { schema: WITNESS_SCHEMA, project, databaseSystemIdentifier: `${identity.database.systemIdentifier}`, owner: 'bound',
    counts, failureCategories };
}

// CLI:
//   node localStackResources.mjs capture <project>                > identity.json
//   node localStackResources.mjs verify  <project> <identity.json>
//   node localStackResources.mjs witness <project> <identity.json>
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, project, file] = process.argv.slice(2);
  try {
    if (command === 'capture') {
      process.stdout.write(`${JSON.stringify(captureStackIdentity(project), null, 2)}\n`);
    } else if (command === 'verify') {
      let identity = null;
      try { identity = JSON.parse(readFileSync(file ?? '', 'utf8')); } catch { identity = null; }
      process.stdout.write(`${JSON.stringify(verifyStackDestroyed(identity, project), null, 2)}\n`);
    } else if (command === 'witness') {
      let identity = null;
      try { identity = JSON.parse(readFileSync(file ?? '', 'utf8')); } catch { identity = null; }
      process.stdout.write(`${JSON.stringify(witnessCleanupRefusal(identity, project))}\n`);
    } else {
      fail('unknown_command');
    }
  } catch (error) {
    process.stderr.write(`${error instanceof StackProofError ? error.message : 'LOCAL_STACK:unexpected_error'}\n`);
    process.exitCode = 1;
  }
}
