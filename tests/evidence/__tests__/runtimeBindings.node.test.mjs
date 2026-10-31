import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyInstalledRuntimes} from '../../../scripts/model-evaluator/runtime-bindings.mjs';
test('installed version AND executable bytes are binding; labels cannot install runtime 5.6',async()=>{
  const root=await mkdtemp(join(tmpdir(),'runtime-binding-'));
  try{
    const dir=join(root,'node_modules/example-runtime');await mkdir(dir,{recursive:true});
    const metadata=JSON.stringify({name:'example-runtime',version:'1.0.0'});const code='export const version="1.0.0";';
    await writeFile(join(dir,'package.json'),metadata);await writeFile(join(dir,'index.js'),code);
    const pin=(path,bytes)=>({path,bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')});
    const inventory={schemaVersion:1,bindings:[{package:'example-runtime',version:'1.0.0',files:[pin('package.json',metadata),pin('index.js',code)]}]};
    assert.equal((await verifyInstalledRuntimes(root,inventory))[0].verifiedFiles,2);
    await writeFile(join(dir,'index.js'),'tampered despite same package version');
    await assert.rejects(verifyInstalledRuntimes(root,inventory),/STALE_INSTALLED_RUNTIME_BYTES/);
    await writeFile(join(dir,'index.js'),code);inventory.bindings[0].version='5.6.0';
    await assert.rejects(verifyInstalledRuntimes(root,inventory),/STALE_INSTALLED_RUNTIME/);
  }finally{await rm(root,{recursive:true,force:true});}
});
