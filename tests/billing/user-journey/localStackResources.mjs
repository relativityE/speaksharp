// This run's disposable Supabase stack: record exactly what it created, then prove exactly that is gone.
// No network, no secrets, no provider content. Docker is reached only through the injected `docker` runner,
// so every rule here is tested offline against a fake.
//
// Sam's #1813 return on 230ae21b:
//  (a) every Docker query is checked on its own; a failed query is an error, never an empty answer;
//  (b) an empty selector after stop is not proof. The identities are captured after creation and each one
//      must be absent after a checked stop; a selector that matched the wrong thing (or nothing) fails.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const IDENTITY_SCHEMA = 'billing-local-stack-identity/v1';
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
  return { schema: 'billing-local-stack-destroyed/v1', project, databaseSystemIdentifier: identity.database.systemIdentifier,
    containers: identity.containers.length, volumes: identity.volumes.length, networks: identity.networks.length, destroyed: true };
}

// CLI:
//   node localStackResources.mjs capture <project>                > identity.json
//   node localStackResources.mjs verify  <project> <identity.json>
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, project, file] = process.argv.slice(2);
  try {
    if (command === 'capture') {
      process.stdout.write(`${JSON.stringify(captureStackIdentity(project), null, 2)}\n`);
    } else if (command === 'verify') {
      let identity = null;
      try { identity = JSON.parse(readFileSync(file ?? '', 'utf8')); } catch { identity = null; }
      process.stdout.write(`${JSON.stringify(verifyStackDestroyed(identity, project), null, 2)}\n`);
    } else {
      fail('unknown_command');
    }
  } catch (error) {
    process.stderr.write(`${error instanceof StackProofError ? error.message : 'LOCAL_STACK:unexpected_error'}\n`);
    process.exitCode = 1;
  }
}
