import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Loads one already-stripped source module by an ordinary import() from a private temporary directory, with no
// vm.SourceTextModule, so no --experimental-vm-modules flag is needed under any runner (full-evidence runs node tests without
// it). Every static import specifier must be named in `imports`; each is replaced by a generated module that
// re-exports exactly the supplied values. A dynamic import() is answered by `dynamicImport(specifier)` when it runs, and
// rejects when none is supplied. Each key
// of `globals` is bound as a module-scope constant ahead of the source, and `meta` replaces `import.meta`. An unexpected static
// specifier fails before evaluation.
let sequence = 0;

export async function importIsolated(source, { imports = {}, globals = {}, meta,
  dynamicImport = async specifier => { throw new Error(`Unexpected dynamic import ${specifier}`); } } = {}) {
  const key = `__importIsolated_${process.pid}_${sequence++}`;
  const specifiers = Object.keys(imports);
  const body = source
    .replace(/\bimport\s*\(/g, () => `globalThis.${key}.dynamicImport(`)
    .replace(/(\bfrom\s+|\bimport\s+)(['"])([^'"]+)\2/g, (whole, lead, quote, specifier) => {
      if (!specifiers.includes(specifier)) throw new Error(`Unexpected import ${specifier}`);
      return `${lead}${quote}./dependency${specifiers.indexOf(specifier)}.mjs${quote}`;
    })
    .replace(/\bimport\.meta\b/g, () => {
      if (meta === undefined) throw new Error('Unexpected import.meta');
      return `globalThis.${key}.meta`;
    });
  const names = Object.keys(globals);
  const prelude = names.length ? `const { ${names.join(', ')} } = globalThis.${key}.globals;\n` : '';
  globalThis[key] = { imports, globals, meta, dynamicImport };
  const dir = await mkdtemp(join(tmpdir(), 'import-isolated-'));
  try {
    await Promise.all(specifiers.map((specifier, index) => {
      const values = `globalThis.${key}.imports[${JSON.stringify(specifier)}]`;
      const exports = Object.keys(imports[specifier]).map(name => name === 'default'
        ? `export default ${values}.default;`
        : `export const ${name} = ${values}[${JSON.stringify(name)}];`);
      return writeFile(join(dir, `dependency${index}.mjs`), `${exports.join('\n')}\n`);
    }));
    await writeFile(join(dir, 'module.mjs'), prelude + body);
    return await import(pathToFileURL(join(dir, 'module.mjs')).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
