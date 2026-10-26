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
    expect(c1CatalogQuery(before127).sql).not.toContain('public.retention_content_free_compatible()');
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
