// Native Postgres with synthetic existing sessions and a stand-in for the previous coaching persistence RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

const migration = fileURLToPath(new URL('../../backend/supabase/migrations/20261117105700_practice_privacy_choices_1835.sql', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/practice-privacy-choices-1835.sql', import.meta.url));

test('practice privacy: native owner choices, metrics-only completion and revision-bound coaching persistence', async () => {
  const names = ['initdb', 'pg_ctl', 'psql'];
  let bin;
  for (const directory of [...(process.env.PATH ?? '').split(delimiter), '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/18/bin']) {
    if (!isAbsolute(directory)) continue;
    try {
      bin = Object.fromEntries(names.map((name) => {
        const file = realpathSync(join(directory, name));
        accessSync(file, constants.X_OK);
        return [name, file];
      }));
      break;
    } catch { /* Only a complete installed toolchain can prove this. */ }
  }
  assert.ok(bin, 'NOT RUN: isolated native Postgres toolchain unavailable');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'privacy-1835-')));
  const data = join(root, 'db');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
    PGHOST: root, PGPORT: '5432', PGUSER: 'privacy_fixture_admin', PGDATABASE: 'postgres' };
  const run = (tool, args) => execFileSync(bin[tool], args, { env, encoding: 'utf8', timeout: 30_000 });
  const peers = [];
  const openPsql = appName => {
    const child = spawn(bin.psql, ['-XqAt', '-v', 'ON_ERROR_STOP=1'], { env: { ...env, PGAPPNAME: appName } });
    const peer = { child, stdout: '', stderr: '' };
    peers.push(peer);
    child.stdout.on('data', chunk => { peer.stdout += chunk; });
    child.stderr.on('data', chunk => { peer.stderr += chunk; });
    child.stdin.on('error', () => { /* a refused psql script can close stdin before all input is consumed */ });
    peer.done = new Promise(resolve => {
      child.on('error', error => { peer.stderr += error.message; });
      child.on('close', resolve);
    });
    return peer;
  };
  const waitFor = async (check, message) => {
    const deadline = Date.now() + 5_000;
    do {
      if (check()) return;
      await setTimeout(25);
    } while (Date.now() < deadline);
    assert.fail(message);
  };
  let started = false;
  try {
    run('initdb', ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale']);
    run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o', `-h '' -k ${root} -p 5432`]);
    started = true;
    assert.equal(run('psql', ['-XqAt', '-c', "SELECT current_setting('data_directory')"]).trim(), data);
    run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1', '-v', `migration=${migration}`, '-f', fixture]);

    // The other owner is still absent. Hold the first insert uncommitted, and prove the
    // other connection actually waited on it before allowing either write to settle.
    const owner = '22222222-2222-4222-8222-222222222222';
    const auth = `SET ROLE authenticated; SET app.fixture_uid='${owner}';\n`;
    const winner = openPsql('privacy_first_winner');
    winner.child.stdin.write(`BEGIN;\n${auth}SELECT choice_revision FROM public.set_practice_privacy_choices_v1(false,false,NULL);\nSELECT 'first_choice_held';\n`);
    await waitFor(() => winner.stdout.includes('first_choice_held'), 'first choice did not hold its transaction');
    const loser = openPsql('privacy_first_loser');
    loser.child.stdin.end(`${auth}SELECT choice_revision FROM public.set_practice_privacy_choices_v1(true,true,NULL);\n`);
    await waitFor(() => run('psql', ['-XqAt', '-c', `SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity WHERE application_name='privacy_first_loser' AND wait_event_type='Lock');`]).trim() === 't',
    'second first choice never waited on the same owner row');
    winner.child.stdin.end('COMMIT;\n');
    assert.equal(await winner.done, 0, winner.stderr);
    assert.match(winner.stdout, /^1\nfirst_choice_held/m);
    assert.equal(await loser.done, 3, loser.stderr);
    assert.match(loser.stderr, /privacy_choices_changed/);
    assert.equal(run('psql', ['-XqAt', '-c', `SELECT transcript_save, ai_coaching, choice_revision
      FROM public.practice_privacy_choices WHERE user_id='${owner}';`]).trim(), 'f|f|1');
  } finally {
    for (const { child } of peers) if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.all(peers.map(peer => peer.done));
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    rmSync(root, { recursive: true, force: true });
  }
});
