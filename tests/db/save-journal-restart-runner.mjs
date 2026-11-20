// A REAL runner process for the save-journal restart proofs (Sam, #1906: "the actual restarted runner still has to prove it can
// find that account after deletion"; "exercise the actual fresh RWT entry point"). Spawned by
// tests/db/deleted-account-save-journal-cleanup-realpg.test.mjs against its owned disposable PostgreSQL, as a fresh process with
// no memory of any earlier one. No hosted database or provider is called.
//
// Input (environment only): PGHOST/PGPORT/PGUSER/PGDATABASE, SJ_PSQL (psql path), GITHUB_* (the run it belongs to; absent = a
// local run), and SJ_MODE:
//   * `teardown` (default): the SHARED live teardown (cleanupRunOwnedAccount, the normal entry point every run-owned journey calls)
//     for ONE account (SJ_UID, SJ_EMAIL). Optionally SJ_HANG_AFTER=deleteUser: right after the Auth deletion the process prints
//     `HUNG_AFTER deleteUser` and waits, so the parent can SIGKILL it there (no finally block runs, nothing is flushed: the claim
//     secret dies with the process). Output: the helper's own counts-only lines, then `RESULT verified` or `RESULT refused <step>`.
//   * `recover`: the governed interrupted-run recovery's entry point (recoverInterruptedRuns) over this database's real Auth table,
//     with SJ_TERMINAL_RUNS (comma-separated run ids GitHub would show as terminated; every other run reads as active), SJ_SHA and
//     SJ_ACK=1 for the delete acknowledgement bound to that SHA. Output: the recovery's one counts-only report line.
//   SJ_TAMPER (either mode) changes what the database answered before the caller sees it, as a broken gateway would:
//   `clip-inventory` drops the last run from the inventory, `malformed-inventory` nulls a run's binding, `clip-resume` drops one
//   id from a resume-by-run answer, `lose-second-inventory` answers the SECOND inventory read with "no such function" (PGRST202),
//   as a gateway that lost the function after the first read would. The database itself is never changed by it.
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { setInterval } from 'node:timers';
import { tsImport } from 'tsx/esm/api';

const IDENT = /^[a-z_][a-z_0-9]*$/;
const lit = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const arg = (k, v) => `${k}=>${k === 'p_run_binding' ? (v === null ? 'NULL::jsonb' : `${lit(JSON.stringify(v))}::jsonb`)
  : k === 'p_user_id' ? `${lit(v)}::uuid` : k === 'p_min_age_seconds' ? `${Number(v)}::integer` : `${lit(v)}::text`}`;
// These two answer one jsonb value (as PostgREST does for a scalar jsonb function); the others an integer or nothing.
const JSON_FNS = new Set(['resume_run_account_save_journal_cleanups_v1', 'list_unfinished_account_save_journal_cleanup_runs_v1']);
function codeOf(stderr) {
  return /permission denied|not claimed by this run|not owned by this run|not run-owned/.test(stderr) ? '42501'
    : /does not exist/.test(stderr) ? '42883' : /account not found|no cleanup claim/.test(stderr) ? 'P0002'
    : /too many/.test(stderr) ? '54000'
    : /run binding required|account id required/.test(stderr) ? '22004' : /secret required|minimum age required/.test(stderr) ? '22023' : '55000';
}

/** What a broken gateway would hand the caller instead of the database's answer (the database is unchanged). */
function tampered(fn, data, tamper) {
  if (tamper === 'clip-inventory' && fn === 'list_unfinished_account_save_journal_cleanup_runs_v1' && data?.runs?.length) return { ...data, runs: data.runs.slice(0, -1) };
  if (tamper === 'malformed-inventory' && fn === 'list_unfinished_account_save_journal_cleanup_runs_v1' && data?.runs?.length)
    return { ...data, runs: [{ ...data.runs[0], binding: null }, ...data.runs.slice(1)] };
  if (tamper === 'clip-resume' && fn === 'resume_run_account_save_journal_cleanups_v1' && data?.ids?.length) return { ...data, ids: data.ids.slice(1) };
  return data;
}

/** The service-role admin client, backed by this database through psql: real Auth rows, real tables, real service_role functions. */
function createPsqlAdmin({ psql, hangAfter, tamper }) {
  const sql = text => execFileSync(psql, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text],
    { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const tableExists = table => sql(`SELECT to_regclass('public.${table}') IS NOT NULL`) === 't';
  let inventoryReads = 0;
  return {
    auth: { admin: {
      getUserById: async uid => {
        const row = sql(`SELECT json_build_object('id',id,'email',email,'app_metadata',coalesce(raw_app_meta_data,'{}'::jsonb))::text FROM auth.users WHERE id=${lit(uid)}`);
        return row ? { data: { user: JSON.parse(row) }, error: null } : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } };
      },
      deleteUser: async uid => {
        try { sql(`DELETE FROM auth.users WHERE id=${lit(uid)}`); } catch { return { error: { message: 'Database error deleting user' } }; }
        if (hangAfter === 'deleteUser') {
          process.stdout.write('HUNG_AFTER deleteUser\n');
          setInterval(() => {}, 1 << 30);           // keep the process alive until the parent kills it
          await new Promise(() => {});
        }
        return { error: null };
      },
      // The real Auth table, paged as the Auth admin API pages it.
      listUsers: async ({ page, perPage }) => {
        const rows = sql(`SELECT coalesce(json_agg(json_build_object('id',u.id,'email',u.email,'created_at',to_jsonb(u)->>'created_at',
          'app_metadata',coalesce(u.raw_app_meta_data,'{}'::jsonb)) ORDER BY u.id),'[]')::text
          FROM (SELECT * FROM auth.users ORDER BY id LIMIT ${Number(perPage)} OFFSET ${(Number(page) - 1) * Number(perPage)}) u`);
        return { data: { users: JSON.parse(rows) }, error: null };
      },
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
    // Every save-journal call runs as service_role, exactly the role PostgREST uses for the service key; errors are returned, never
    // thrown. The feedback-fence listing (another migration, not in this fixture) answers "no such function", as PostgREST would.
    rpc: async (fn, params) => {
      if (!IDENT.test(fn)) throw new Error('bad function');
      if (fn === 'list_unfinished_account_save_journal_cleanup_runs_v1' && ++inventoryReads === 2 && tamper === 'lose-second-inventory') {
        return { data: null, error: { code: 'PGRST202', message: 'lost' } };
      }
      if (fn === 'list_unresolved_rwt_feedback_fences_v1') return { data: null, error: { code: 'PGRST202', message: 'not in this fixture' } };
      const call = `public.${fn}(${Object.entries(params).map(([k, v]) => arg(k, v)).join(',')})`;
      try {
        if (JSON_FNS.has(fn)) return { data: tampered(fn, JSON.parse(sql(`SET ROLE service_role; SELECT ${call}::text`)), tamper), error: null };
        const value = sql(`SET ROLE service_role; SELECT ${call}`);
        return { data: value === '' ? null : Number(value), error: null };
      } catch (e) {
        const stderr = String(e.stderr ?? e.message);
        return { data: null, error: { code: codeOf(stderr), message: 'database error' } };
      }
    },
  };
}

/** The shared teardown of one account, as a journey's teardown calls it. Returns the result line. */
async function runTeardown(admin, { uid, email }) {
  const { cleanupRunOwnedAccount, cleanupFailureStep } = await tsImport('../live/helpers/runOwnedCleanup.ts', import.meta.url);
  try {
    await cleanupRunOwnedAccount({ admin, capturedUid: uid, createdEmail: email, runOwnedPrefix: 'rwt-journey-' });
    return 'RESULT verified';
  } catch (error) {
    return `RESULT refused ${cleanupFailureStep(error)}`;
  }
}

/** The governed interrupted-run recovery's entry point, as the recovery spec calls it. Returns its report line. */
async function runRecovery(admin, { terminalRuns, sha, ack }) {
  const { recoverInterruptedRuns, recoveryDeleteAck, recoveryReportLine } = await tsImport('../live/helpers/rwtInterruptedRunRecovery.ts', import.meta.url);
  const report = await recoverInterruptedRuns({ admin, nowMs: Date.now(), ack: ack ? recoveryDeleteAck(sha) : '', sha, domain: 'example.test',
    runState: async binding => (terminalRuns.includes(binding.runId) ? 'terminal' : 'active') });
  return recoveryReportLine(report);
}

const admin = createPsqlAdmin({ psql: process.env.SJ_PSQL, hangAfter: process.env.SJ_HANG_AFTER, tamper: process.env.SJ_TAMPER });
const line = process.env.SJ_MODE === 'recover'
  ? await runRecovery(admin, { terminalRuns: (process.env.SJ_TERMINAL_RUNS ?? '').split(',').filter(Boolean), sha: process.env.SJ_SHA ?? '', ack: process.env.SJ_ACK === '1' })
  : await runTeardown(admin, { uid: process.env.SJ_UID, email: process.env.SJ_EMAIL });
process.stdout.write(`${line}\n`);
