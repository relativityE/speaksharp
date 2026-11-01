import { readFile, writeFile, mkdir, realpath, stat, link, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sealModelPackage, verifyModelPackage, expectedModelIdentity, candidateFromPackage, type ModelPackage } from '../../frontend/src/services/transcription/modelPackage';
import { verifyProjectRuntimeBindings } from './runtime-bindings.mjs';
import { CANDIDATES } from '../../frontend/src/services/transcription/candidateRegistry';

/** Every existing ancestor up to the repository root must be its own canonical path. */
async function refuseSymlinkedAncestors(root: string, start: string) {
    let ancestor=start;
    for(;;){
        try{if(await realpath(ancestor)!==ancestor)throw Error('PACKAGE_IMPORT_SYMLINK_DESTINATION');}
        catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        if(ancestor===resolve(root))return;
        const parent=dirname(ancestor);if(parent===ancestor)throw Error('PACKAGE_IMPORT_DESTINATION_INVALID');ancestor=parent;
    }
}
export async function importModelPackage(root: string, descriptorPath: string) {
    const source = await realpath(resolve(descriptorPath));
    const data = JSON.parse(await readFile(source,'utf8')) as ModelPackage;
    const pkg = data.packageDigest ? await verifyModelPackage(data) : await sealModelPackage(data);
    if (Object.hasOwn(CANDIDATES,pkg.id) && !CANDIDATES[pkg.id].modelPackage) throw Error('PACKAGE_SHADOWS_BUILTIN');
    await verifyProjectRuntimeBindings(root);
    // Only already present files are read. Import never fetches weights, dependencies or executable code.
    // EVERY component is verified before anything is written, so a bad last file leaves no partial import.
    const directory = dirname(source);
    const copies: Array<{destination: string; bytes: Buffer; sha256: string}> = [];
    for (const asset of pkg.assets.files) {
        const path = resolve(directory,asset.path);
        if (!path.startsWith(directory+'/') || await realpath(path)!==path || !(await stat(path)).isFile()) throw Error('PACKAGE_IMPORT_PATH_INVALID');
        const bytes = await readFile(path);
        if (bytes.length!==asset.bytes || createHash('sha256').update(bytes).digest('hex')!==asset.sha256) throw Error('PACKAGE_IMPORT_ASSET_MISMATCH');
        // Upstream-pinned Moonshine weights stay upstream: the validated profile admits only https
        // components with no executable bytes, and the runtime re-verifies each one on every load.
        // Other engines keep requiring self-hosted assets, since their packages can carry runtime code.
        if (pkg.engine==='moonshine-streaming' && asset.url.startsWith('https://')) continue;
        if (!asset.url.startsWith('/models/')) throw Error('PACKAGE_IMPORT_REQUIRES_LOCAL_ASSETS');
        const destination = resolve(root,'frontend/public',asset.url.slice(1));
        if (!destination.startsWith(resolve(root,'frontend/public/models')+'/')) throw Error('PACKAGE_IMPORT_DESTINATION_INVALID');
        await refuseSymlinkedAncestors(root,dirname(destination));
        // A conflicting file already in place is refused now, before any other component is copied.
        const existing = await readFile(destination).catch((error: NodeJS.ErrnoException) => {
            if (error.code==='ENOENT') return null; throw error;
        });
        if (existing && createHash('sha256').update(existing).digest('hex')!==asset.sha256) throw Error('PACKAGE_IMPORT_DESTINATION_CONFLICT');
        copies.push({destination,bytes,sha256:asset.sha256});
    }
    const target = join(root,'frontend/src/services/transcription/model-packages',pkg.id.replace(/:/g,'_')+'.json');
    await refuseSymlinkedAncestors(root,dirname(target));
    for (const {destination,bytes,sha256} of copies) {
        await mkdir(dirname(destination),{recursive:true});
        try { await writeFile(destination,bytes,{flag:'wx'}); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code!=='EEXIST' || createHash('sha256').update(await readFile(destination)).digest('hex')!==sha256) throw error;
        }
    }
    await mkdir(dirname(target),{recursive:true});
    // Publish a fully written descriptor with an exclusive link: readers never see partial JSON, and an
    // existing candidate is never overwritten. Only an identical package may already be there.
    const staging = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(staging,JSON.stringify(pkg,null,2)+'\n',{flag:'wx'});
    try { await link(staging,target); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code!=='EEXIST' || (await verifyModelPackage(JSON.parse(await readFile(target,'utf8')))).packageDigest!==pkg.packageDigest) throw error;
    }
    finally { await unlink(staging); }
    return {candidateId:pkg.id,packageDigest:pkg.packageDigest,descriptor:target,
        identity:expectedModelIdentity(candidateFromPackage(pkg,target))};
}
/** Stage adoption of the SAME package. Does not activate, deploy, or alter the current selector. */
export async function stagePackageAdoption(root: string, descriptorPath: string, reportPath: string, output: string) {
    const pkg = await verifyModelPackage(JSON.parse(await readFile(descriptorPath,'utf8')));
    await verifyProjectRuntimeBindings(root);
    const bytes=await readFile(reportPath); const report=JSON.parse(bytes.toString());
    if(report.qualification!=='PASS' || report.mode!=='product-lifecycle' || !Array.isArray(report.qualifiedPackages)
        || !report.qualifiedPackages.includes(pkg.packageDigest)) throw Error('PACKAGE_NOT_PRODUCT_QUALIFIED');
    const config={candidate:pkg.id,approvedPackages:[{packageDigest:pkg.packageDigest,evidenceSha256:createHash('sha256').update(bytes).digest('hex')}]};
    await writeFile(output,JSON.stringify(config,null,2)+'\n',{flag:'wx'});
    return {packageDigest:pkg.packageDigest,stagedConfig:output,activation:'REQUIRES_SEPARATE_OWNER_SELECTION'};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const [operation,input,arg,output]=process.argv.slice(2);
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const result=operation==='import' && input ? await importModelPackage(root,input)
        : operation==='stage-adoption' && input && arg && output ? await stagePackageAdoption(root,input,arg,output)
        : (()=>{throw Error('Usage: model-package.mts import package.json | stage-adoption package.json product-report.json output.json');})();
    console.log(JSON.stringify(result));
}
