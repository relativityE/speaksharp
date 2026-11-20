// A REAL runner process for the save-journal restart proof (Sam, #1906: "the actual restarted runner still has to prove it can
// find that account after deletion"). Spawned by tests/db/deleted-account-save-journal-cleanup-realpg.test.mjs against its owned
// disposable PostgreSQL. It runs the SHARED live teardown (cleanupRunOwnedAccount, the normal entry point every run-owned journey
// calls) for ONE account, as the GitHub run its environment names, with a service-role admin client backed by that database.
//
// Input (environment only): PGHOST/PGPORT/PGUSER/PGDATABASE, SJ_PSQL (psql path), SJ_UID and SJ_EMAIL (the account THIS process
// cleans), GITHUB_* (the run it belongs to; absent = a local run), and optionally SJ_HANG_AFTER=deleteUser: right after the Auth
// deletion the process prints `HUNG_AFTER deleteUser` and waits, so the parent can SIGKILL it there (no finally block runs, nothing
// is flushed: the claim secret dies with the process). Output: the helper's own counts-only lines, then `RESULT verified` or
// `RESULT refused <step>`. No hosted database or provider is called.
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { setInterval } from 'node:timers';
import { tsImport } from 'tsx/esm/api';

const { cleanupRunOwnedAccount, cleanupFailureStep } = await tsImport('../live/helpers/runOwnedCleanup.ts', import.meta.url);

const sql = text => execFileSync(process.env.SJ_PSQL, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text],
  { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lit = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const IDENT = /^[a-z_][a-z_0-9]*$/;
const tableExists = table => sql(`SELECT to_regclass('public.${table}') IS NOT NULL`) === 't';
const arg = (k, v) => `${k}=>${k === 'p_run_binding' ? (v === null ? 'NULL::jsonb' : `${lit(JSON.stringify(v))}::jsonb`)
  : k === 'p_user_id' ? `${lit(v)}::uuid` : k === 'p_min_age_seconds' ? `${Number(v)}::integer` : `${lit(v)}::text`}`;
// Set-returning functions answer an array, as PostgREST does; the others a scalar.
const SETOF = new Set(['resume_run_account_save_journal_cleanups_v1', 'list_unfinished_account_save_journal_cleanup_runs_v1']);
function codeOf(stderr) {
  return /permission denied|not claimed by this run|not owned by this run|not run-owned/.test(stderr) ? '42501'
    : /does not exist/.test(stderr) ? '42883' : /account not found|no cleanup claim/.test(stderr) ? 'P0002'
    : /run binding required|account id required/.test(stderr) ? '22004' : /secret required|minimum age required/.test(stderr) ? '22023' : '55000';
}

const admin = {
  auth: { admin: {
    getUserById: async uid => {
      const row = sql(`SELECT json_build_object('id',id,'email',email,'app_metadata',coalesce(raw_app_meta_data,'{}'::jsonb))::text FROM auth.users WHERE id=${lit(uid)}`);
      return row ? { data: { user: JSON.parse(row) }, error: null } : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } };
    },
    deleteUser: async uid => {
      try { sql(`DELETE FROM auth.users WHERE id=${lit(uid)}`); } catch { return { error: { message: 'Database error deleting user' } }; }
      if (process.env.SJ_HANG_AFTER === 'deleteUser') {
        process.stdout.write('HUNG_AFTER deleteUser\n');
        setInterval(() => {}, 1 << 30);           // keep the process alive until the parent kills it
        await new Promise(() => {});
      }
      return { error: null };
    },
    listUsers: async () => { throw new Error('not used by the teardown'); },
  } },
  from: table => {
    if (!IDENT.test(table)) throw new Error('bad table');
    return {
      select: (columns, opts) => ({ eq: async (column, value) => {
        if (!IDENT.test(column) || !columns.split(',').every(c => IDENT.test(c))) throw new Error('bad column');
        // Residue tables this fixture does not create answer a counted 0 (product tables outside the save journal under test).
        if (opts?.head) return { count: tableExists(table) ? Number(sql(`SELECT count(*) FROM public.${table} WHERE ${column}=${lit(value)}`)) : 0, error: null };
        if (!tableExists(table)) return { data: [], error: null };
        const rows = sql(`SELECT coalesce(json_agg(json_build_object(${columns.split(',').map(c => `'${c}',${c}`).join(',')})),'[]')::text FROM public.${table} WHERE ${column}=${lit(value)}`);
        return { data: JSON.parse(rows), error: null };
      } }),
      delete: () => ({ eq: async (column, value) => {
        if (!IDENT.test(column)) throw new Error('bad column');
        if (tableExists(table)) sql(`DELETE FROM public.${table} WHERE ${column}=${lit(value)}`);
        return { error: null };
      } }),
    };
  },
  // Every save-journal call runs as service_role, exactly the role PostgREST uses for the service key; errors are returned, never thrown.
  rpc: async (fn, params) => {
    if (!IDENT.test(fn)) throw new Error('bad function');
    const call = `public.${fn}(${Object.entries(params).map(([k, v]) => arg(k, v)).join(',')})`;
    try {
      if (SETOF.has(fn)) return { data: JSON.parse(sql(`SET ROLE service_role; SELECT coalesce(json_agg(x),'[]')::text FROM ${call} x`)), error: null };
      const value = sql(`SET ROLE service_role; SELECT ${call}`);
      return { data: value === '' ? null : Number(value), error: null };
    } catch (e) {
      const stderr = String(e.stderr ?? e.message);
      return { data: null, error: { code: codeOf(stderr), message: 'database error' } };
    }
  },
};

try {
  await cleanupRunOwnedAccount({ admin, capturedUid: process.env.SJ_UID, createdEmail: process.env.SJ_EMAIL, runOwnedPrefix: 'rwt-journey-' });
  process.stdout.write('RESULT verified\n');
} catch (error) {
  process.stdout.write(`RESULT refused ${cleanupFailureStep(error)}\n`);
}
