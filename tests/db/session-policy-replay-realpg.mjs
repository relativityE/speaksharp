// Real PostgreSQL/RLS proof on an owned disposable cluster; no provider or full-chain claim.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';

const root = mkdtempSync(join(process.env.GITHUB_ACTIONS === 'true' ? process.env.RUNNER_TEMP : '/private/tmp', 'session-policy-replay-'));
const data = join(root, 'data');
const socket = join(root, 'socket');
mkdirSync(socket);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const connection = ['-h', socket, '-p', '5432', '-U', 'replay_admin', '-d', 'postgres'];
const execute = (input) => spawnSync('psql', [...connection, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
  { env, input, encoding: 'utf8', timeout: 15_000 });
const sql = (input) => {
  const result = execute(input);
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
};
const migration = readFileSync('backend/supabase/migrations/20250825065500_fix_rls_performance_issue.sql', 'utf8');
// Freeze the actual pre-fix migration from main for the negative replay control.
const original = execFileSync('git', ['show', '2b7a8dc2b493203c548330f97b86c4a2d4b34da5:backend/supabase/migrations/20250825065500_fix_rls_performance_issue.sql'], { encoding: 'utf8' });
const legacy = `
CREATE POLICY "Users can view their own sessions" ON sessions FOR SELECT USING(auth.uid()=user_id);
CREATE POLICY "Users can insert their own sessions" ON sessions FOR INSERT WITH CHECK(auth.uid()=user_id);
CREATE POLICY "Users can update their own sessions" ON sessions FOR UPDATE USING(auth.uid()=user_id);
CREATE POLICY "Users can delete their own sessions" ON sessions FOR DELETE USING(auth.uid()=user_id);`;
const assertions = `
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='sessions'::regclass)<>2
 OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='sessions'::regclass AND polname='untouched restrictive')
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='sessions'::regclass)
 THEN RAISE EXCEPTION 'catalog/RLS/unrelated policy changed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$ DECLARE n int; BEGIN
 IF (SELECT count(*) FROM sessions)<>1 THEN RAISE EXCEPTION 'cross-user read permitted'; END IF;
 INSERT INTO sessions(id,user_id,title) VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','own');
 UPDATE sessions SET title='own-updated' WHERE id='33333333-3333-4333-8333-333333333333';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'owner update denied'; END IF;
 DELETE FROM sessions WHERE id='33333333-3333-4333-8333-333333333333';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'owner delete denied'; END IF;
 UPDATE sessions SET title='stolen' WHERE user_id='22222222-2222-4222-8222-222222222222';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'cross-user update permitted'; END IF;
 DELETE FROM sessions WHERE user_id='22222222-2222-4222-8222-222222222222';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'cross-user delete permitted'; END IF;
 BEGIN
  INSERT INTO sessions(id,user_id) VALUES('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222');
  RAISE EXCEPTION 'cross-user insert permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE n int; BEGIN
 IF (SELECT count(*) FROM sessions)<>0 THEN RAISE EXCEPTION 'anonymous read permitted'; END IF;
 UPDATE sessions SET title='anonymous'; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'anonymous update permitted'; END IF;
 DELETE FROM sessions; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'anonymous delete permitted'; END IF;
 BEGIN
  INSERT INTO sessions(id,user_id) VALUES('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111');
  RAISE EXCEPTION 'anonymous insert permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$; RESET ROLE;`;
const transaction = (shape, source, checks = assertions) => `BEGIN; SET LOCAL ROLE replay_owner;
${shape} ${source} ${checks} ROLLBACK;`;
let started = false;
try {
  execFileSync('initdb', ['-D', data, '-U', 'replay_admin', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { env, stdio: 'pipe' });
  execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-w', 'start', '-o', `-F -k ${socket} -h '' -p 5432`], { env, stdio: 'pipe' });
  started = true;
  assert.equal(sql("SHOW data_directory;"), data);
  if (process.env.PROOF_PG_MAJOR) {
    assert.equal(Math.floor(Number(sql('SHOW server_version_num;')) / 10000), Number(process.env.PROOF_PG_MAJOR),
      'declared PostgreSQL matrix version differs from the executed server');
  }
  sql(`CREATE EXTENSION "uuid-ossp"; CREATE ROLE replay_owner NOSUPERUSER;
    CREATE ROLE authenticated NOSUPERUSER; CREATE ROLE anon NOSUPERUSER;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth,public TO replay_owner,authenticated,anon;
    GRANT CREATE ON SCHEMA public TO replay_owner; GRANT REFERENCES ON auth.users TO replay_owner;
    SET ROLE replay_owner; ${readFileSync('backend/supabase/migrations/20250811062708_initial_schema.sql','utf8')}
    ${readFileSync('backend/supabase/migrations/20250812032300_update_usage_tracking.sql','utf8')}
    ${readFileSync('backend/supabase/migrations/20250819072116_add_accuracy_to_sessions.sql','utf8')}
    GRANT SELECT,INSERT,UPDATE,DELETE ON sessions TO authenticated,anon;
    CREATE POLICY "untouched restrictive" ON sessions AS RESTRICTIVE FOR ALL USING(true);
    RESET ROLE;
    INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
    INSERT INTO sessions(id,user_id) SELECT id,id FROM auth.users;`);
  const aclQuery = `SELECT jsonb_build_object(
    'tables',(SELECT jsonb_agg(jsonb_build_array(relname,relacl::text) ORDER BY relname)
      FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'),
    'functions',(SELECT jsonb_agg(jsonb_build_array(proname,proacl::text) ORDER BY proname)
      FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'auth'::regnamespace)))::text`;
  const acl = sql(aclQuery);
  const aclAssertion = `DO $$ BEGIN IF (${aclQuery}) IS DISTINCT FROM '${acl.replace(/'/g, "''")}'
    THEN RAISE EXCEPTION 'table or RPC grants changed'; END IF; END $$;`;
  const red = execute(transaction('', original, ''));
  assert.notEqual(red.status, 0);
  assert.match(red.stderr, /policy "Users can view their own sessions".*does not exist/);
  console.log('RED original consolidated replay: expected missing-policy failure');
  const mixedRed = execute(transaction(legacy, original, ''));
  assert.notEqual(mixedRed.status, 0); assert.match(mixedRed.stderr, /policy "Users can manage own sessions".*already exists/);
  console.log('RED original mixed replay: expected duplicate-policy failure');
  sql(transaction(`DROP POLICY "Users can manage own sessions" ON sessions; ${legacy}`, original, assertions + aclAssertion));
  console.log('CONTROL original legacy shape preserves owner CRUD and denial');
  for (const [name, shape] of [
    ['consolidated', ''], ['legacy', `DROP POLICY "Users can manage own sessions" ON sessions; ${legacy}`],
    ['mixed', legacy], ['idempotent', migration],
  ]) {
    sql(transaction(shape, migration, assertions + aclAssertion));
    console.log(`GREEN ${name}: catalog, RLS, owner CRUD, cross-user/anonymous denial, ACL preservation`);
  }
  for (const shape of [
    'ALTER POLICY "Users can manage own sessions" ON sessions USING(true);',
    'ALTER POLICY "Users can manage own sessions" ON sessions TO authenticated;',
    'DROP POLICY "Users can manage own sessions" ON sessions;',
  ]) {
    const refused = execute(transaction(shape, migration, ''));
    assert.notEqual(refused.status, 0); assert.match(refused.stderr, /unexpected session replacement policy/);
  }
  console.log('GREEN unexpected predicate/role/empty shapes rejected');
  const mutant = migration.replace('FOR ALL USING ((select auth.uid()) = user_id);', 'FOR ALL USING (true);');
  assert.notEqual(mutant, migration);
  const negative = execute(transaction('', mutant));
  assert.notEqual(negative.status, 0); assert.match(negative.stderr, /cross-user read permitted/);
  console.log(JSON.stringify({ result: 'PASS', postgres: sql('SHOW server_version;'),
    negativeMutationCaught: true, providerCalls: 0, fullSupabaseChain: 'NOT EXECUTED' }));
} finally {
  if (started || existsSync(join(data,'postmaster.pid'))) execFileSync('pg_ctl', ['-D',data,'-w','stop','-m','immediate'], { env, stdio:'pipe' });
  rmSync(root, { recursive:true, force:true });
}
