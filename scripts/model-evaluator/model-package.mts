import { readFile, readdir, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as modelPackage from '../../frontend/src/services/transcription/modelPackage';
import { sealModelPackage, verifyModelPackage, expectedModelIdentity, candidateFromPackage, type ModelPackage } from '../../frontend/src/services/transcription/modelPackage';
import { verifyProjectRuntimeBindings } from './runtime-bindings.mjs';
import { CANDIDATES, admitPackageDescriptors } from '../../frontend/src/services/transcription/candidateRegistry';
import { isApprovedUpstreamPin } from '../../frontend/src/services/transcription/moonshineAssetPins';

/**
 * Moonshine packages are upstream-pinned data (the parser requires https, like the built-in Moonshine models):
 * the installed adapter fetches each component from its pinned URL after user consent and verifies its bytes.
 * Import admits only the upstream hosts the reviewed built-in pins already use; it never adds a download source.
 */
function upstreamPinned(pkg: ModelPackage, url: string): boolean {
    if (!url.startsWith('https://')) return false;
    if (!isApprovedUpstreamPin(pkg.engine, url)) throw Error('PACKAGE_IMPORT_UPSTREAM_HOST_NOT_APPROVED');
    return true;
}

const PACKAGES_DIRECTORY = 'frontend/src/services/transcription/model-packages';
/** The exact descriptor text the importer writes, and so the text the bundle admits. */
const descriptorText = (pkg: ModelPackage) => JSON.stringify(pkg, null, 2) + '\n';
const packageKey = (file: string) => './model-packages/' + file;

/**
 * Elon/Sam review of 38253831: under Node, `CANDIDATES` holds the built-ins only (the package glob is a Vite feature), so a
 * check against it missed a package that reuses an already imported package's cache directory. The bundle admits the
 * descriptors in path order and refuses the later one, which is the previously imported package when the new file sorts
 * first. Before any write, run the product's own admission over the existing descriptors with and without the new one:
 * the new package must be admitted, and every package admitted today must still be.
 */
async function refuseCatalogueConflict(root: string, pkg: ModelPackage) {
    const directory = join(root, PACKAGES_DIRECTORY);
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return [] as string[]; throw error; });
    const existing: Record<string, string> = {};
    for (const name of names.filter(name => name.endsWith('.json')).sort()) existing[packageKey(name)] = await readFile(join(directory, name), 'utf8');
    const ownKey = packageKey(pkg.id.replace(/:/g, '_') + '.json');
    // Elon's review of c1585147: admit the exact bytes the importer writes (the size limit is on the raw text).
    const proposed: Record<string, string> = { ...existing, [ownKey]: descriptorText(pkg) };
    const ordered = Object.fromEntries(Object.keys(proposed).sort().map(key => [key, proposed[key]]));
    const today = admitPackageDescriptors(existing, modelPackage).imported;
    const after = admitPackageDescriptors(ordered, modelPackage);
    const refused = after.rejections.find(item => item.file === ownKey);
    if (refused) throw Error(refused.code);
    if (!Object.hasOwn(after.imported, pkg.id)) throw Error('PACKAGE_INVALID');
    // The new package was admitted but displaced one admitted today: the collision is the same, only the order differs.
    const displaced = Object.keys(today).find(id => !Object.hasOwn(after.imported, id));
    if (displaced) throw Error(after.rejections.find(item => item.file !== ownKey)?.code ?? 'PACKAGE_IDENTITY_COLLISION');
}

export async function importModelPackage(root: string, descriptorPath: string) {
    const source = await realpath(resolve(descriptorPath));
    const data = JSON.parse(await readFile(source,'utf8')) as ModelPackage;
    const pkg = data.packageDigest ? await verifyModelPackage(data) : await sealModelPackage(data);
    if (Object.hasOwn(CANDIDATES,pkg.id) && !CANDIDATES[pkg.id].modelPackage) throw Error('PACKAGE_SHADOWS_BUILTIN');
    await refuseCatalogueConflict(root, pkg);
    await verifyProjectRuntimeBindings(root);
    // Only already present files are copied. Import never fetches weights, dependencies or executable code.
    const directory = dirname(source);
    for (const asset of pkg.assets.files) {
        const path = resolve(directory,asset.path);
        if (!path.startsWith(directory+'/') || await realpath(path)!==path || !(await stat(path)).isFile()) throw Error('PACKAGE_IMPORT_PATH_INVALID');
        const bytes = await readFile(path);
        if (bytes.length!==asset.bytes || createHash('sha256').update(bytes).digest('hex')!==asset.sha256) throw Error('PACKAGE_IMPORT_ASSET_MISMATCH');
        // An upstream-pinned component is proven by its local bytes but not copied: the runtime fetches it from its pin.
        if (upstreamPinned(pkg,asset.url)) continue;
        if (!asset.url.startsWith('/models/')) throw Error('PACKAGE_IMPORT_REQUIRES_LOCAL_ASSETS');
        const destination = resolve(root,'frontend/public',asset.url.slice(1));
        if (!destination.startsWith(resolve(root,'frontend/public/models')+'/')) throw Error('PACKAGE_IMPORT_DESTINATION_INVALID');
        let ancestor=dirname(destination);
        for(;;){
            try{if(await realpath(ancestor)!==ancestor)throw Error('PACKAGE_IMPORT_SYMLINK_DESTINATION');}
            catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
            if(ancestor===resolve(root))break;
            const parent=dirname(ancestor);if(parent===ancestor)throw Error('PACKAGE_IMPORT_DESTINATION_INVALID');ancestor=parent;
        }
        await mkdir(dirname(destination),{recursive:true});
        try { await writeFile(destination,bytes,{flag:'wx'}); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code!=='EEXIST' || createHash('sha256').update(await readFile(destination)).digest('hex')!==asset.sha256) throw error;
        }
    }
    const target = join(root,'frontend/src/services/transcription/model-packages',pkg.id.replace(/:/g,'_')+'.json');
    await mkdir(dirname(target),{recursive:true});
    // Never overwrite an existing candidate or silently change an imported identity.
    try { await writeFile(target,descriptorText(pkg),{flag:'wx'}); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code!=='EEXIST' || (await verifyModelPackage(JSON.parse(await readFile(target,'utf8')))).packageDigest!==pkg.packageDigest) throw error;
    }
    return {candidateId:pkg.id,packageDigest:pkg.packageDigest,descriptor:target,
        identity:expectedModelIdentity(candidateFromPackage(pkg,target))};
}
/**
 * Stage an adoption PROPOSAL for the SAME package. Does not activate, deploy, or alter the current selector,
 * and its output is not a selector config: `activeCandidate()` admits a package only through the registry's
 * activationReady, because nothing yet binds a report hash to an authoritative completed evaluation.
 */
export async function stagePackageAdoption(root: string, descriptorPath: string, reportPath: string, output: string) {
    const pkg = await verifyModelPackage(JSON.parse(await readFile(descriptorPath,'utf8')));
    await verifyProjectRuntimeBindings(root);
    const bytes=await readFile(reportPath); const report=JSON.parse(bytes.toString());
    if(report.qualification!=='PASS' || report.mode!=='product-lifecycle' || !Array.isArray(report.qualifiedPackages)
        || !report.qualifiedPackages.includes(pkg.packageDigest)) throw Error('PACKAGE_NOT_PRODUCT_QUALIFIED');
    const proposal={kind:'speaksharp-adoption-proposal',candidate:pkg.id,packageDigest:pkg.packageDigest,
        productReportSha256:createHash('sha256').update(bytes).digest('hex'),activation:'REQUIRES_REGISTRY_ACTIVATION_REVIEW'};
    await writeFile(output,JSON.stringify(proposal,null,2)+'\n',{flag:'wx'});
    return {packageDigest:pkg.packageDigest,stagedProposal:output,activation:proposal.activation};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const [operation,input,arg,output]=process.argv.slice(2);
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const result=operation==='import' && input ? await importModelPackage(root,input)
        : operation==='stage-adoption' && input && arg && output ? await stagePackageAdoption(root,input,arg,output)
        : (()=>{throw Error('Usage: model-package.mts import package.json | stage-adoption package.json product-report.json output.json');})();
    console.log(JSON.stringify(result));
}
