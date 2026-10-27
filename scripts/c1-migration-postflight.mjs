// Exact C1 catalog-only checks. Never applies migrations or calls a mutating RPC.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {c1Contract,c1CatalogQuery,assertC1Catalog} from './lib/c1MigrationPostflight.mjs';

try {
  const [operation,version,receipt]=process.argv.slice(2);
  const mode=operation?.replace(/^sql-/,'');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const contract=c1Contract(root,mode,version);
  const query=c1CatalogQuery(contract);
  if(operation===`sql-${mode}`) {
    console.log(query.sql);
  } else {
    if(!['before','after'].includes(operation)||!path.isAbsolute(receipt||''))throw new Error('invalid C1 receipt path/operation');
    const prior=mode==='after'?JSON.parse(fs.readFileSync(receipt,'utf8')):null;
    const args=process.env.DB_URL?[process.env.DB_URL]:[];
    const raw=execFileSync('psql',[...args,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',
      `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=public,pg_temp; ${query.sql} COMMIT;`],
    {encoding:'utf8',timeout:30000,stdio:['ignore','pipe','ignore'],
      env:{...process.env,PGOPTIONS:`${process.env.PGOPTIONS||''} -c default_transaction_read_only=on`}}).trim();
    const catalog=JSON.parse(raw);
    const result=assertC1Catalog(catalog,contract,prior);
    if(mode==='before')fs.writeFileSync(receipt,JSON.stringify({version,targetSha256:contract.targetSha256,catalog}),{flag:'wx'});
    console.log(JSON.stringify({mode,version,...result,scope:'catalog and unchanged retention activation only; no customer-flow proof'}));
  }
} catch(error) {
  const reason=/^(?:C1 |invalid C1)/.test(error.message||'')?error.message:'C1 catalog verification could not execute';
  console.error(`${reason}; migration/release remains held`);process.exitCode=1;
}
