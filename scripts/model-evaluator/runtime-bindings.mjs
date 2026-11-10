import { readFile, realpath, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

async function installedPackage(root, name, parent) {
    let start = parent ? await realpath(join(root, 'node_modules', parent)) : root;
    for (;;) {
        const candidate = join(start, 'node_modules', name);
        try { return await realpath(candidate); } catch { /* follow normal parent lookup */ }
        const next = dirname(start); if (next === start) throw Error('RUNTIME_NOT_INSTALLED:' + name);
        start = next;
    }
}
/** Verify installed executable bytes, not just an editable version label. No imports execute the runtime. */
export async function verifyInstalledRuntimes(root, inventory) {
    if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.bindings) || !inventory.bindings.length) throw Error('RUNTIME_BINDING_INVENTORY_INVALID');
    const results = [];
    for (const binding of inventory.bindings) {
        const directory = await installedPackage(root, binding.package, binding.parent);
        const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (metadata.name !== binding.package || metadata.version !== binding.version) throw Error('STALE_INSTALLED_RUNTIME:' + binding.package);
        if (!Array.isArray(binding.files) || !binding.files.length || !binding.files.some(f => f.path === 'package.json')) throw Error('RUNTIME_BINDING_PINS_MISSING');
        for (const file of binding.files) {
            const path = resolve(directory, file.path);
            if (!path.startsWith(directory + '/') || await realpath(path) !== path || !(await stat(path)).isFile()) throw Error('RUNTIME_BINDING_PATH_INVALID');
            const bytes = await readFile(path);
            if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('STALE_INSTALLED_RUNTIME_BYTES:' + binding.package);
        }
        results.push({ package: binding.package, version: metadata.version, verifiedFiles: binding.files.length });
    }
    return results;
}
export async function verifyProjectRuntimeBindings(root) {
    const inventory = JSON.parse(await readFile(join(root, 'frontend/src/services/transcription/runtimeBindings.json'), 'utf8'));
    return verifyInstalledRuntimes(root, inventory);
}
export function runtimeBindingsPlugin(root = fileURLToPath(new URL('../../', import.meta.url))) {
    return { name: 'speaksharp-runtime-binding', async buildStart() { await verifyProjectRuntimeBindings(root); } };
}
