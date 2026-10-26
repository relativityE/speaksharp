// Owned native PostgreSQL proof using the existing Stage B migration fixtures.
// Controlled default/direct grants prove the mechanism, not a deployed Supabase ACL.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';

const root = mkdtempSync(join(process.env.GITHUB_ACTIONS === 'true' ? process.env.RUNNER_TEMP : '/private/tmp', 'v2-acl-replay-'));
const data = join(root, 'data'); const socket = join(root, 'socket'); mkdirSync(socket);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const connection = ['-h', socket, '-p', '5432', '-U', 'acl_replay_admin', '-d', 'postgres'];
const execute = (input) => spawnSync('psql', [...connection, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { env, input, encoding: 'utf8', timeout: 15_000 });
const sql = (input) => {
    const result = execute(input);
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    return result.stdout.trim();
};
const migrationPath = 'backend/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql';
const old = execFileSync('git', ['show', `c8b1c2917dd3f1f27ff0b8dc1bb2e95335f59ee1:${migrationPath}`], { encoding: 'utf8' });
const current = readFileSync(migrationPath, 'utf8');
const readMigration = (name) => readFileSync(`backend/supabase/migrations/${name}.sql`, 'utf8');
const stageB = readMigration('20260829120000_retire_complete_session_v1_1306');
const suite = readFileSync('tests/db/stage-b-retire-complete-session-v1.integration.test.ts', 'utf8');
const extra = suite.match(/const EXTRA = `([\s\S]*?)`;/)?.[1];
assert.ok(extra, 'existing Stage B fixture unavailable');
const setup = readFileSync('tests/db/transcript-retention-converge-bootstrap.sql', 'utf8')
    + ['20260801000000_sessions_transcript_state', '20260803000000_transcript_retention_newest_two',
        '20260804000000_transcript_retention_converge_on_save'].map(readMigration).join('\n')
    + extra.replaceAll('${U}', '11111111-1111-4111-8111-111111111111')
    + readMigration('20260816223606_metrics_only_additive_1306');
const identity = 'public.complete_session_v2(uuid,text,integer,text,jsonb,integer,double precision,double precision,jsonb,jsonb,text)';
const catalog = () => JSON.parse(sql(`SELECT json_build_object(
 'identity',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,
 'body',md5(p.prosrc),'securityDefiner',p.prosecdef,'config',p.proconfig,
 'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
 'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'serviceRole',has_function_privilege('service_role',p.oid,'EXECUTE'),
 'publicExecute',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
 'defaultPrivileges',(SELECT coalesce(json_agg(json_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'type',d.defaclobjtype,'acl',d.defaclacl)),'[]') FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace),
 'roles',(SELECT json_agg(json_build_object('role',rolname,'inherit',rolinherit,'superuser',rolsuper)) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
 'memberships',(SELECT coalesce(json_agg(json_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member))),'[]') FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))
 ) FROM pg_proc p WHERE p.oid='${identity}'::regprocedure;`));
const safe = (c) => { assert.equal(c.anon, false); assert.equal(c.publicExecute, false); assert.equal(c.authenticated, true); assert.equal(c.serviceRole, true); };
const reset = (source = current, defaults = false) => sql(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
 ${setup}
 ${defaults ? 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;' : ''}
 ${source}`);
let started = false;
try {
    execFileSync('initdb', ['-D', data, '-U', 'acl_replay_admin', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { env, stdio: 'pipe' });
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-w', 'start', '-o', `-F -k ${socket} -h '' -p 5432 -c max_connections=10`], { env, stdio: 'pipe' }); started = true;
    assert.equal(sql("SELECT current_setting('data_directory');"), data);
    const version = Number(sql("SELECT current_setting('server_version_num');"));
    if (process.env.PROOF_PG_MAJOR) assert.equal(Math.floor(version / 10000), Number(process.env.PROOF_PG_MAJOR));
    sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    const observations = [];
    for (const shape of ['default', 'direct']) {
        reset(old, shape === 'default');
        if (shape === 'direct') sql(`GRANT EXECUTE ON FUNCTION ${identity} TO anon;`);
        const before = catalog(); assert.equal(before.anon, true); assert.equal(before.publicExecute, false);
        const red = execute(stageB); assert.notEqual(red.status, 0); assert.match(red.stderr, /Stage B refused: complete_session_v2 is executable by anon/);
        // psql disconnect rolled back the failed BEGIN; reapply only the shipped corrected create migration.
        sql(current); const after = catalog(); safe(after);
        for (const key of ['identity', 'owner', 'body', 'securityDefiner', 'config', 'defaultPrivileges', 'roles', 'memberships']) assert.deepEqual(after[key], before[key], key);
        sql(stageB); assert.equal(sql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='complete_session';"), '0');
        observations.push({ shape, before, after, red: 'anon refused', green: 'retirement passed' });
        // Fresh corrected creation must also be safe under the same default privileges.
        reset(current, shape === 'default'); safe(catalog()); sql(stageB);
    }
    const negatives = [
        [`DROP FUNCTION ${identity};`, /exact complete_session_v2 identity is absent/],
        [`DROP FUNCTION ${identity}; CREATE FUNCTION public.complete_session_v2(uuid,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`, /exact complete_session_v2 identity is absent/],
        ["CREATE FUNCTION public.complete_session_v2(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;", /exactly one complete_session_v2 overload/],
        [`REVOKE EXECUTE ON FUNCTION ${identity} FROM authenticated;`, /not executable by authenticated/],
        [`REVOKE EXECUTE ON FUNCTION ${identity} FROM service_role;`, /not executable by service_role/],
        [`GRANT EXECUTE ON FUNCTION ${identity} TO anon;`, /executable by anon/],
        [`GRANT EXECUTE ON FUNCTION ${identity} TO PUBLIC;`, /executable by anon/],
        ['GRANT authenticated TO anon;', /executable by anon/],
    ];
    for (const [mutation, expected] of negatives) {
        reset(); sql(mutation); const result = execute(stageB);
        assert.notEqual(result.status, 0); assert.match(result.stderr, expected);
    }
    console.log(JSON.stringify({ result: 'PASS', version, fixture: 'controlled native grants; not Supabase catalog', observations, negativeControls: negatives.length, stageBUnchanged: true, providerCalls: 0 }));
} finally {
    if (started) execFileSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { env, stdio: 'pipe' });
    rmSync(root, { recursive: true, force: true });
}
