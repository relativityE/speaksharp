// Offline controls for Sam's #1813 return on 230ae21b, (a) and (b). Docker is a fake; nothing runs.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { test } from 'vitest';
import { captureStackIdentity, verifyStackDestroyed, type DockerAnswer, type StackIdentity } from './localStackResources.mjs';

const PROJECT = 'billing-local-stack-123456-1';
const LABEL = `label=com.supabase.cli.project=${PROJECT}`;
const NAME = `name=_${PROJECT}`;
const ok = (stdout = ''): DockerAnswer => ({ code: 0, stdout, stderr: '' });
const missing = (kind: string): DockerAnswer => ({ code: 1, stdout: '', stderr: `Error: No such ${kind}: x` });
const KINDS = ['container', 'volume', 'network'] as const;
type Kind = typeof KINDS[number];

/** A fake Docker daemon holding this run's stack. `override` replaces any answer by its joined args. */
function daemon(alive: boolean, override: Record<string, DockerAnswer> = {}, held: Partial<Record<Kind, string[]>> = {}) {
  const calls: string[] = [];
  const resources: Record<Kind, string[]> = {
    container: alive ? ['c_db', 'c_auth'] : [],
    volume: alive ? [`supabase_db_${PROJECT}`, `supabase_config_${PROJECT}`] : [],
    network: alive ? ['n_net'] : [],
    ...held,
  };
  const run = (args: string[]): DockerAnswer => {
    const key = args.join(' ');
    calls.push(key);
    if (key in override) return override[key];
    const listed = (kind: Kind) => ok(resources[kind].map(r => `${r}\n`).join(''));
    if (args[0] === 'ps') return listed('container');
    if (args[0] === 'volume' && args[1] === 'ls') return listed('volume');
    if (args[0] === 'network' && args[1] === 'ls') return listed('network');
    if (args[0] === 'container' && args[1] === 'inspect' && args[2] === '--format') {
      const target = args[4];
      if (target === `supabase_db_${PROJECT}`) return alive ? ok(`c_db /supabase_db_${PROJECT} ${PROJECT}\n`) : missing('container');
      return resources.container.includes(target) ? ok(`${PROJECT}\n`) : missing('container');
    }
    if (args[0] === 'exec') return alive ? ok('7300000000000000001\n') : { code: 1, stdout: '', stderr: 'No such container' };
    if (args[1] === 'inspect') return resources[args[0] as Kind].includes(args[2]) ? ok('[{}]') : missing(args[0]);
    throw new Error(`unexpected docker call: ${key}`);
  };
  return { run, calls };
}

const listArgs = (kind: Kind, filter: string) => ({
  container: `ps -aq --no-trunc --filter ${filter}`,
  volume: `volume ls -q --filter ${filter}`,
  network: `network ls -q --no-trunc --filter ${filter}`,
})[kind];

const captured = (): StackIdentity => captureStackIdentity(PROJECT, daemon(true).run);

test('capture records this run\'s exact containers, volumes, networks and database identity', () => {
  const identity = captured();
  assert.deepEqual(identity.containers, ['c_auth', 'c_db']);
  assert.deepEqual(identity.volumes, [`supabase_config_${PROJECT}`, `supabase_db_${PROJECT}`]);
  assert.deepEqual(identity.networks, ['n_net']);
  assert.deepEqual(identity.database, { container: 'c_db', volume: `supabase_db_${PROJECT}`, systemIdentifier: '7300000000000000001' });
});

test('(a) negative control: a failed Docker query is an error for every resource type and both selectors, never empty', () => {
  for (const kind of KINDS) {
    for (const filter of [LABEL, NAME]) {
      const failed = { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' };
      assert.throws(() => captureStackIdentity(PROJECT, daemon(true, { [listArgs(kind, filter)]: failed }).run),
        new RegExp(`${kind}_query_failed`), `capture ${kind} ${filter}`);
      assert.throws(() => verifyStackDestroyed(captured(), PROJECT, daemon(false, { [listArgs(kind, filter)]: failed }).run),
        new RegExp(`${kind}_query_failed`), `verify ${kind} ${filter}`);
    }
  }
});

test('(a) negative control: the old combined shell form masked a failed first query', () => {
  // containers="$(docker ... label ...; docker ... name ...)" takes the exit status of the second command only.
  const masked = spawnSync('bash', ['-c', 'set -euo pipefail; x="$(false; true)"; echo "status=$? x=[$x]"'], { encoding: 'utf8' });
  assert.equal(masked.stdout.trim(), 'status=0 x=[]');
});

test('(b) a stack whose every captured identity is gone after a checked stop is proven destroyed', () => {
  const docker = daemon(false);
  const proof = verifyStackDestroyed(captured(), PROJECT, docker.run);
  assert.equal(proof.destroyed, true);
  assert.equal(proof.databaseSystemIdentifier, '7300000000000000001');
  // Each exact identity was inspected, not just the selectors.
  for (const id of ['c_db', 'c_auth', 'n_net', `supabase_db_${PROJECT}`]) assert.ok(docker.calls.some(c => c.endsWith(` inspect ${id}`)), id);
});

test('(b) negative control: any one captured identity that remains fails, for every resource type', () => {
  const identity = captured();
  const remaining: [Kind, string][] = [['container', 'c_db'], ['volume', `supabase_db_${PROJECT}`], ['network', 'n_net']];
  for (const [kind, id] of remaining) {
    // The selectors now see nothing (e.g. a label stripped or a rename), but the exact identity still exists.
    const docker = daemon(false, { [`${kind} inspect ${id}`]: ok('[{}]') });
    assert.throws(() => verifyStackDestroyed(identity, PROJECT, docker.run), new RegExp(`${kind}_remains`), kind);
  }
});

test('(b) negative control: an inspect error that is not Docker\'s "no such" answer is unverified, not absent', () => {
  const identity = captured();
  for (const [kind, id] of [['container', 'c_auth'], ['volume', `supabase_config_${PROJECT}`], ['network', 'n_net']] as const) {
    const docker = daemon(false, { [`${kind} inspect ${id}`]: { code: 1, stdout: '', stderr: 'permission denied' } });
    assert.throws(() => verifyStackDestroyed(identity, PROJECT, docker.run), new RegExp(`${kind}_absence_unverified`), kind);
  }
});

test('(b) negative control: a resource the selectors still find after stop fails, for every resource type', () => {
  for (const kind of KINDS) {
    const docker = daemon(false, {}, { [kind]: ['left_behind'] });
    assert.throws(() => verifyStackDestroyed(captured(), PROJECT, docker.run), new RegExp(`${kind}_remains`), kind);
  }
});

test('(b) negative control: a wrong selector fails qualification at capture', () => {
  // Matches nothing.
  for (const kind of KINDS) {
    assert.throws(() => captureStackIdentity(PROJECT, daemon(true, { [listArgs(kind, LABEL)]: ok(''), [listArgs(kind, NAME)]: ok('') }).run),
      new RegExp(`${kind}_selector_matched_nothing`), kind);
  }
  // Label and name selectors disagree (one of them points at something else).
  for (const kind of KINDS) {
    assert.throws(() => captureStackIdentity(PROJECT, daemon(true, { [listArgs(kind, NAME)]: ok('someone_else\n') }).run),
      new RegExp(`${kind}_selectors_disagree`), kind);
  }
  // Both selectors agree on resources that are not this run's database.
  const notOurs = daemon(true, { [listArgs('container', LABEL)]: ok('c_other\n'), [listArgs('container', NAME)]: ok('c_other\n') });
  assert.throws(() => captureStackIdentity(PROJECT, notOurs.run), /database_container_not_captured/);
  const noDbVolume = daemon(true, {}, { volume: [`supabase_config_${PROJECT}`] });
  assert.throws(() => captureStackIdentity(PROJECT, noDbVolume.run), /database_volume_not_captured/);
  const foreignLabel = daemon(true, { [`container inspect --format {{index .Config.Labels "com.supabase.cli.project"}} c_auth`]: ok('another-project\n') });
  assert.throws(() => captureStackIdentity(PROJECT, foreignLabel.run), /container_not_this_run/);
  const unreadableDb = daemon(true, { [`exec supabase_db_${PROJECT} psql -U postgres -tAc select system_identifier from pg_control_system()`]: ok('oops\n') });
  assert.throws(() => captureStackIdentity(PROJECT, unreadableDb.run), /database_identity_unreadable/);
});

test('(b) negative control: a missing, foreign or malformed identity cannot be verified', () => {
  const identity = captured();
  const docker = () => daemon(false).run;
  for (const bad of [null, {}, { ...identity, project: 'billing-local-stack-999-1' }, { ...identity, containers: [] },
    { ...identity, volumes: [] }, { ...identity, networks: [] }, { ...identity, extra: 1 },
    { ...identity, database: { ...identity.database, container: 'c_elsewhere' } },
    { ...identity, database: { ...identity.database, systemIdentifier: '' } }]) {
    assert.throws(() => verifyStackDestroyed(bad, PROJECT, docker()), /LOCAL_STACK:identity_/, JSON.stringify(bad));
  }
  assert.throws(() => verifyStackDestroyed(identity, 'billing-local-stack-999-1', docker()), /identity_not_this_run/);
  assert.throws(() => captureStackIdentity('backend', daemon(true).run), /project_invalid/);
});
