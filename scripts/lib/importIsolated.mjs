import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Loads one already-stripped source module by an ordinary import() from a private temporary directory, with no
// vm.SourceTextModule, so no --experimental-vm-modules flag is needed under any runner (full-evidence runs node tests without
// it). The source is parsed, not pattern-matched, so comments and strings can neither hide nor fake a module reference. Every
// static `import`/`export ... from` specifier must be named in `imports`; each is replaced by a generated module that
// re-exports exactly the supplied values. A dynamic import() is answered by `dynamicImport(specifier)` when it runs, and
// rejects when none is supplied. Each key of `globals` is bound as a module-scope constant ahead of the source, and `meta`
// replaces `import.meta`. An unexpected static specifier, an unsupplied import.meta or a syntax error fails before evaluation.
let sequence = 0;

function rewrite(source, key, specifiers, meta) {
  const file = ts.createSourceFile('module.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`Unparseable module: ${file.parseDiagnostics[0].messageText}`);
  const edits = [];
  const replace = (node, text) => edits.push({ start: node.getStart(file), end: node.getEnd(), text });
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = node.moduleSpecifier.text;
      if (!specifiers.includes(specifier)) throw new Error(`Unexpected import ${specifier}`);
      replace(node.moduleSpecifier, JSON.stringify(`./dependency${specifiers.indexOf(specifier)}.mjs`));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      replace(node.expression, `globalThis.${key}.dynamicImport`);
    } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      if (meta === undefined) throw new Error('Unexpected import.meta');
      replace(node, `globalThis.${key}.meta`);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return edits.sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}

export async function importIsolated(source, { imports = {}, globals = {}, meta,
  dynamicImport = async specifier => { throw new Error(`Unexpected dynamic import ${specifier}`); } } = {}) {
  const key = `__importIsolated_${process.pid}_${sequence++}`;
  const specifiers = Object.keys(imports);
  const body = rewrite(source, key, specifiers, meta);
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
