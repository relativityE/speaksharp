// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {C1_VERSIONS,c1Contract,c1CatalogQuery,assertC1Catalog,functionDefinitions} from '../../scripts/lib/c1MigrationPostflight.mjs';
import {EXACT_MIGRATION_ALLOWLIST} from '../../scripts/lib/exactMigrationGate.mjs';
import {bootstrapSql} from '../db/content-free-retention-evidence.realpg.mjs';

const root=process.cwd();
const witness=contract=>({checks:c1CatalogQuery(contract).names.map(name=>({name,ok:true})),
  activation:[{policy_version:'newest_one_v1',activated_at:'2026-09-20T16:29:29.114Z'}]});

describe('C1 exact source/catalog postflight',()=>{
  it('executes all three real disposable catalog states and refuses body, ACL and trigger drift',async()=>{
    const sql=version=>readFileSync(`backend/supabase/migrations/${EXACT_MIGRATION_ALLOWLIST.find(row=>row.version===version).file}`,'utf8');
    const bootstrap=bootstrapSql(),fence=sql(C1_VERSIONS[0]);
    expect(bootstrap.split(fence)).toHaveLength(2);
    const db=new PGlite();
    try {
      await db.exec(bootstrap.replace(fence,''));
      const catalog=async contract=>JSON.parse((await db.query(c1CatalogQuery(contract).sql)).rows[0].jsonb_build_object);
      let prior;
      for(const version of C1_VERSIONS) {
        const before=c1Contract(root,'before',version),after=c1Contract(root,'after',version);
        const preimage=await catalog(before);
        expect(assertC1Catalog(preimage,before).passed).toBe(true);
        prior={version,targetSha256:before.targetSha256,catalog:preimage};
        await db.exec(`SET ROLE closure_owner; ${sql(version)} RESET ROLE;`);
        expect(assertC1Catalog(await catalog(after),after,prior).passed).toBe(true);
        const drift=version===C1_VERSIONS[0]?[
          ['127 WHEN(false)',`DROP TRIGGER a_guard_account_coaching_ai_suggestions_insert ON public.sessions;
            CREATE TRIGGER a_guard_account_coaching_ai_suggestions_insert BEFORE INSERT ON public.sessions
              FOR EACH ROW WHEN(false) EXECUTE FUNCTION public.guard_account_coaching_ai_suggestions_write_v1()`],
          ['127 wrong function',`CREATE FUNCTION public.fixture_wrong_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
            DROP TRIGGER a_guard_account_coaching_ai_suggestions_insert ON public.sessions;
            CREATE TRIGGER a_guard_account_coaching_ai_suggestions_insert BEFORE INSERT ON public.sessions
              FOR EACH ROW WHEN(NEW.ai_suggestions IS NOT NULL) EXECUTE FUNCTION public.fixture_wrong_guard()`],
          ['127 wrong UPDATE columns',`DROP TRIGGER a_guard_account_coaching_ai_suggestions_update ON public.sessions;
            CREATE TRIGGER a_guard_account_coaching_ai_suggestions_update BEFORE UPDATE OF total_words ON public.sessions
              FOR EACH ROW WHEN(NEW.ai_suggestions IS DISTINCT FROM OLD.ai_suggestions)
              EXECUTE FUNCTION public.guard_account_coaching_ai_suggestions_write_v1()`],
          ['127 wrong timing',`DROP TRIGGER a_guard_account_coaching_ai_suggestions_update ON public.sessions;
            CREATE TRIGGER a_guard_account_coaching_ai_suggestions_update AFTER UPDATE OF ai_suggestions ON public.sessions
              FOR EACH ROW WHEN(NEW.ai_suggestions IS DISTINCT FROM OLD.ai_suggestions)
              EXECUTE FUNCTION public.guard_account_coaching_ai_suggestions_write_v1()`],
          ['127 inner writer exposed','GRANT EXECUTE ON FUNCTION public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer) TO service_role'],
          ['127 receipt table write restored','GRANT INSERT,UPDATE ON public.ai_suggestion_authority_receipts TO service_role'],
          ['127 receipt column write restored','GRANT INSERT(session_id) ON public.ai_suggestion_authority_receipts TO service_role'],
          ['127 intended fence execution removed','REVOKE EXECUTE ON FUNCTION public.fence_account_coaching_unknown_v1(uuid,uuid,uuid,uuid,text,text) FROM service_role'],
          ['127 cache execution exposed','GRANT EXECUTE ON FUNCTION public.record_ai_suggestion_cache_read_v1(uuid,uuid) TO authenticated'],
        ]:[
          ['128 WHEN(false)',`DROP TRIGGER aa_retention_content_row_guard ON public.sessions;
            CREATE TRIGGER aa_retention_content_row_guard BEFORE INSERT OR UPDATE OF transcript,transcript_state,user_id,status,created_at,engine,engine_version,model_name,product ON public.sessions
              FOR EACH ROW WHEN(false) EXECUTE FUNCTION public._ss_retention_content_row_guard()`],
          ['128 wrong function',`DROP TRIGGER aa_retention_content_row_guard ON public.sessions;
            CREATE TRIGGER aa_retention_content_row_guard BEFORE INSERT OR UPDATE OF transcript,transcript_state,user_id,status,created_at,engine,engine_version,model_name,product ON public.sessions
              FOR EACH ROW EXECUTE FUNCTION public._ss_retention_expired_derived_guard()`],
          ['128 wrong UPDATE columns',`DROP TRIGGER aa_retention_content_row_guard ON public.sessions;
            CREATE TRIGGER aa_retention_content_row_guard BEFORE INSERT OR UPDATE OF transcript ON public.sessions
              FOR EACH ROW EXECUTE FUNCTION public._ss_retention_content_row_guard()`],
          ['128 wrong row mode',`DROP TRIGGER aa_retention_content_row_guard ON public.sessions;
            CREATE TRIGGER aa_retention_content_row_guard BEFORE INSERT OR UPDATE OF transcript,transcript_state,user_id,status,created_at,engine,engine_version,model_name,product ON public.sessions
              FOR EACH STATEMENT EXECUTE FUNCTION public._ss_retention_content_row_guard()`],
          ['128 expiry grants exposed','GRANT SELECT ON public.transcript_retention_expiry_grants TO service_role'],
          ['128 expiry column exposed','GRANT SELECT(capture_id) ON public.transcript_retention_expiry_grants TO authenticated'],
        ];
        for(const [name,mutation] of drift) {
          await db.exec(`BEGIN; SET ROLE closure_owner; ${mutation};`);
          try {
            const actual=await catalog(after);
            expect(()=>assertC1Catalog(actual,after,prior)).toThrow(/C1 catalog mismatch/);
            console.info(JSON.stringify({c1CatalogDrift:name,version,status:'REFUSED'}));
          }
          finally {await db.exec('ROLLBACK; RESET ROLE;');}
        }
        expect(assertC1Catalog(await catalog(after),after,prior).passed).toBe(true);
      }
      const contract=c1Contract(root,'after',C1_VERSIONS[1]);
      for(const mutation of [
        'ALTER FUNCTION public.complete_session_v2(uuid,text,integer,text,jsonb,integer,double precision,double precision,jsonb,jsonb,text) SECURITY INVOKER',
        'GRANT SELECT ON public.session_progress_content_evidence TO service_role',
        'ALTER TABLE public.sessions DISABLE TRIGGER aa_retention_content_row_guard',
      ]) {
        await db.exec(`BEGIN; SET ROLE closure_owner; ${mutation};`);
        try {const actual=await catalog(contract);expect(()=>assertC1Catalog(actual,contract,prior)).toThrow(/C1 catalog mismatch/);}
        finally {await db.exec('ROLLBACK; RESET ROLE;');}
      }
      expect(assertC1Catalog(await catalog(contract),contract,prior).passed).toBe(true);
    } finally {await db.close();}
  },60000);
  it('pins both source files and parses every declared target function',()=>{
    for(const [index,version] of C1_VERSIONS.entries()) {
      const pin=EXACT_MIGRATION_ALLOWLIST.find(row=>row.version===version);
      const source=readFileSync(`backend/supabase/migrations/${pin.file}`,'utf8');
      expect(createHash('sha256').update(source).digest('hex')).toBe(pin.sha256);
      expect(functionDefinitions(source)).toHaveLength(index===0?7:14);
    }
  });
  it('requires reviewed predecessor bodies, absence of future objects, and ordered127→128 states',()=>{
    const before127=c1Contract(root,'before',C1_VERSIONS[0]);
    const after127=c1Contract(root,'after',C1_VERSIONS[0]);
    const before128=c1Contract(root,'before',C1_VERSIONS[1]);
    const after128=c1Contract(root,'after',C1_VERSIONS[1]);
    expect(before127.stage).toBe(0);expect(after127.stage).toBe(1);expect(after128.stage).toBe(2);
    expect(after127.functions).toEqual(before128.functions);
    expect(before127.functions.some(row=>row.expected===null)).toBe(true);
    expect(after128.functions.every(row=>row.expected!==null)).toBe(true);
    // The signature must be checked for absence; the not-yet-installed function must never be called.
    expect(c1CatalogQuery(before127).sql).toContain("to_regprocedure('public.retention_content_free_compatible()') IS NULL");
    expect(c1CatalogQuery(before127).sql).not.toMatch(/(?:AND|SELECT)\s+public\.retention_content_free_compatible\(\)/);
    expect(c1CatalogQuery(after128).sql).toContain("'retention-pins'");
  });
  it('accepts complete boolean catalog proof but refuses missing/duplicated/false/null rows and changed activation',()=>{
    for(const version of C1_VERSIONS) {
      const before=c1Contract(root,'before',version),after=c1Contract(root,'after',version);
      const prior={version,targetSha256:before.targetSha256,catalog:witness(before)};
      const current=witness(after);
      expect(assertC1Catalog(current,after,prior).passed).toBe(true);
      for(const mutate of [value=>value.checks.pop(),value=>value.checks.push(value.checks[0]),
        value=>{value.checks[0].ok=false;},value=>{value.checks[0].ok=null;},
        value=>{value.activation[0].activated_at=null;},value=>{delete value.activation[0].activated_at;}]) {
        const changed=structuredClone(current);mutate(changed);
        expect(()=>assertC1Catalog(changed,after,prior)).toThrow();
      }
      expect(()=>assertC1Catalog(current,after,{...prior,targetSha256:'0'.repeat(64)})).toThrow();
      for(const missing of [undefined,null,{}, {...prior,catalog:null}])expect(()=>assertC1Catalog(current,after,missing)).toThrow();
      expect(()=>c1Contract(root,'after','unselected')).toThrow();
    }
  });
});
