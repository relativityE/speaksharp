// Shared catalog hook, executed by the PGlite consumer and owned native proof.
// Callable evidence does not establish native process startup or customer journeys.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bootstrapSql,candidate} from './content-free-retention-evidence.realpg.mjs';
import {C1_VERSIONS,c1Contract,c1CatalogQuery,assertC1Catalog} from '../../scripts/lib/c1MigrationPostflight.mjs';

async function proveC1CatalogStages(exec) {
  const fenceSql=readFileSync('backend/supabase/migrations/20261024083000_account_coaching_unknown_fence_1643.sql','utf8');
  const bootstrap=bootstrapSql();
  assert.equal(bootstrap.split(fenceSql).length,2,'fixture contains exactly one complete fence migration');
  await exec(bootstrap.replace(fenceSql,''));
  const checks=[];
  for(const version of C1_VERSIONS) {
    const before=c1Contract(process.cwd(),'before',version),after=c1Contract(process.cwd(),'after',version);
    const catalog=async contract=>JSON.parse((await exec(c1CatalogQuery(contract).sql)).trim());
    const preimage=await catalog(before);
    checks.push({phase:'before',version,...assertC1Catalog(preimage,before)});
    await exec(`SET ROLE closure_owner; ${version===C1_VERSIONS[0]?fenceSql:candidate()} RESET ROLE;`);
    checks.push({phase:'after',version,...assertC1Catalog(await catalog(after),after,
      {version,targetSha256:before.targetSha256,catalog:preimage})});
  }
  return checks;
}

export {proveC1CatalogStages};
