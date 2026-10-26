// SELECT-only C1 catalog proof. No application RPC, customer row or secret value is read.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EXACT_MIGRATION_ALLOWLIST} from './exactMigrationGate.mjs';

export const C1_VERSIONS=Object.freeze(['20261024083000','20261025021046']);
const digest=(kind,value)=>createHash(kind).update(value).digest('hex');
const literal=value=>`'${value.replaceAll("'","''")}'`;

export function functionDefinitions(source) {
  const result=[];
  const pattern=/^[ \t]*CREATE(?: OR REPLACE)? FUNCTION public\.([a-z_0-9]+)\s*\(([\s\S]*?)\)\s*RETURNS\b([\s\S]*?)\bAS\s+(\$\w*\$)([\s\S]*?)\4([\s\S]*?);/gim;
  for(const match of source.matchAll(pattern)) {
    const parameters=match[2].trim()?match[2].split(',').map(value=>{
      const field=/^\s*[a-z_][a-z_0-9]*\s+(uuid|boolean|bool|jsonb|text|date|integer|int|double\s+precision|public\.sessions)(?:\s+DEFAULT\s+[\s\S]+)?\s*$/i.exec(value);
      if(!field)return null;
      return field[1].toLowerCase().replace(/\s+/g,' ').replace(/^int$/,'integer').replace(/^bool$/,'boolean');
    }):[];
    // Other historical functions may use types outside this deliberately narrow contract.
    if(parameters.some(value=>value===null))continue;
    const header=match[3]+match[6];
    const language=/\bLANGUAGE\s+(sql|plpgsql)\b/i.exec(header)?.[1]?.toLowerCase();
    const returns=match[3].split(/\b(?:LANGUAGE|SECURITY|SET|STABLE|IMMUTABLE|VOLATILE)\b/i)[0].trim().toLowerCase();
    if(!language || !/^(?:trigger|jsonb|boolean|text|uuid|void)$/.test(returns))continue;
    const setting=/\bSET\s+search_path\s*(?:=|TO)\s*(''|'[^']*'|[a-z_]+(?:\s*,\s*[a-z_]+)*)/i.exec(header)?.[1];
    const searchPath=setting===undefined?null:setting.replace(/^'|'$/g,'').replace(/\s*,\s*/g,', ');
    result.push({signature:`public.${match[1].toLowerCase()}(${parameters.join(',')})`,
      bodyMd5:digest('md5',match[5]),language,returns,securityDefiner:/\bSECURITY\s+DEFINER\b/i.test(header),
      volatility:/\bIMMUTABLE\b/i.test(header)?'i':/\bSTABLE\b/i.test(header)?'s':'v',
      config:searchPath===null?null:[`search_path=${searchPath||'""'}`]});
  }
  return result;
}

export function c1Contract(root,mode,version) {
  const index=C1_VERSIONS.indexOf(version);
  if(!['before','after'].includes(mode)||index<0)throw new Error('invalid C1 phase/target');
  const directory=path.join(root,'backend/supabase/migrations');
  const targets=C1_VERSIONS.map(value=>{
    const pin=EXACT_MIGRATION_ALLOWLIST.find(entry=>entry.version===value);
    if(!pin)throw new Error('C1 target absent from exact allowlist');
    const file=path.join(directory,pin.file);
    if(!fs.lstatSync(file).isFile()||fs.realpathSync(file)!==file)throw new Error('C1 source alias');
    const source=fs.readFileSync(file,'utf8');
    if(digest('sha256',source)!==pin.sha256)throw new Error('C1 migration source mismatch');
    const functions=functionDefinitions(source);
    if(functions.length!==(value===C1_VERSIONS[0]?7:14))throw new Error('C1 function source shape unavailable');
    return {pin,functions};
  });
  const needed=new Map(targets.flatMap(target=>target.functions).map(fn=>[fn.signature,fn]));
  const state=new Map();
  const last=mode==='after'?version:index===0?'20261020230653':C1_VERSIONS[index-1];
  for(const file of fs.readdirSync(directory).filter(name=>/^\d{8,14}_.*\.sql$/.test(name)).sort()) {
    if(file.split('_')[0]>last)continue;
    for(const fn of functionDefinitions(fs.readFileSync(path.join(directory,file),'utf8'))) {
      if(needed.has(fn.signature))state.set(fn.signature,fn);
    }
  }
  const stage=index+(mode==='after'?1:0);
  return {mode,version,targetSha256:targets[index].pin.sha256,stage,
    functions:[...needed.keys()].sort().map(signature=>({signature,expected:state.get(signature)||null}))};
}

export function c1CatalogQuery(contract) {
  const checks=[];
  const add=(name,expression)=>checks.push(`SELECT ${literal(name)} AS name,(${expression}) AS ok`);
  for(const {signature,expected} of contract.functions) {
    if(!expected){add(`function:${signature}`,`to_regprocedure(${literal(signature)}) IS NULL`);continue;}
    const config=expected.config===null?'NULL::jsonb':`${literal(JSON.stringify(expected.config))}::jsonb`;
    add(`function:${signature}`,`EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(${literal(signature)})
      AND md5(p.prosrc)=${literal(expected.bodyMd5)} AND l.lanname=${literal(expected.language)}
      AND pg_get_function_result(p.oid)=${literal(expected.returns)} AND p.prosecdef=${expected.securityDefiner}
      AND p.provolatile=${literal(expected.volatility)} AND to_jsonb(p.proconfig) IS NOT DISTINCT FROM ${config}
      AND p.proowner=(SELECT relowner FROM pg_class WHERE oid='public.account_closure_attempts'::regclass))`);
  }
  for(const [table,stage] of [['account_coaching_fences',1],['session_progress_content_evidence',2],
    ['transcript_retention_replacement_context',2],['transcript_retention_function_pins',2]]) {
    add(`table:${table}`,contract.stage<stage?`to_regclass('public.${table}') IS NULL`:
      `EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.${table}') AND c.relrowsecurity AND NOT c.relforcerowsecurity
        AND c.relowner=(SELECT relowner FROM pg_class WHERE oid='public.account_closure_attempts'::regclass)
        AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          WHERE a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated','service_role')))`);
  }
  add('capture-column',`EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.transcript_retention_expiry_grants'::regclass
    AND attname='capture_id' AND NOT attisdropped AND atttypid='uuid'::regtype AND NOT attnotnull)=${contract.stage===2}`);
  for(const [name,table,stage] of [['a_guard_account_coaching_ai_suggestions_insert','sessions',1],
    ['a_guard_account_coaching_ai_suggestions_update','sessions',1],['aa_retention_content_statement_lock','sessions',2],
    ['aa_retention_content_row_guard','sessions',2],['aa_retention_expired_derived_guard','sessions',2],
    ['aa_retention_recovery_write_guard','transcript_retention_tombstones',2]]) {
    add(`trigger:${name}`,contract.stage<stage?`NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=${literal(name)} AND tgrelid='public.${table}'::regclass)`:
      `1=(SELECT count(*) FROM pg_trigger WHERE tgname=${literal(name)} AND tgrelid='public.${table}'::regclass AND NOT tgisinternal AND tgenabled='O')`);
  }
  if(contract.stage===2)add('retention-pins',`(SELECT count(*) FROM public.transcript_retention_function_pins)=8 AND public.retention_content_free_compatible()`);
  return {names:checks.map(sql=>/^SELECT '([^']+)'/.exec(sql)[1]),sql:`WITH checks AS (${checks.join('\nUNION ALL\n')})
    SELECT jsonb_build_object('checks',(SELECT jsonb_agg(jsonb_build_object('name',name,'ok',ok) ORDER BY name) FROM checks),
      'activation',(SELECT jsonb_agg(jsonb_build_object('policy_version',policy_version,'activated_at',activated_at) ORDER BY singleton)
        FROM public.transcript_retention_activation))::text;`};
}

export function assertC1Catalog(value,contract,before) {
  const actual=typeof value==='string'?JSON.parse(value):value;
  const names=c1CatalogQuery(contract).names.sort();
  if(!actual||!Array.isArray(actual.checks)||JSON.stringify(actual.checks.map(row=>row.name).sort())!==JSON.stringify(names))throw new Error('C1 catalog evidence incomplete');
  for(const row of actual.checks)if(row.ok!==true)throw new Error(`C1 catalog mismatch: ${row.name}`);
  if(!Array.isArray(actual.activation)||actual.activation.length!==1||actual.activation[0].policy_version!=='newest_one_v1'
    ||!Object.hasOwn(actual.activation[0],'activated_at')
    ||(actual.activation[0].activated_at!==null&&(typeof actual.activation[0].activated_at!=='string'||!Number.isFinite(Date.parse(actual.activation[0].activated_at)))))throw new Error('C1 retention activation state unavailable');
  if(contract.mode==='after'&&(!before||before.version!==contract.version||before.targetSha256!==contract.targetSha256
    ||!before.catalog||JSON.stringify(before.catalog.activation)!==JSON.stringify(actual.activation)))throw new Error('C1 prior receipt missing or retention activation changed during apply');
  return {passed:true,checks:names.length,retentionEnabled:actual.activation[0].activated_at!==null};
}
