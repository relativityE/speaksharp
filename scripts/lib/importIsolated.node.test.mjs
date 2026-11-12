import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importIsolated } from './importIsolated.mjs';

// #1760 review: a comment between `import` and `(` bypassed the former regex, so the real module system resolved the call.
test('a comment inside a dynamic import still routes it through dynamicImport', async () => {
  const seen = [];
  const api = await importIsolated(
    "export const load = () => import /* hidden */ ('node:fs');\nexport const loadPlain = () => import(`node:os`);",
    { dynamicImport: async specifier => { seen.push(specifier); return { stub: specifier }; } });
  assert.deepEqual(await api.load(), { stub: 'node:fs' });
  assert.deepEqual(await api.loadPlain(), { stub: 'node:os' });
  assert.deepEqual(seen, ['node:fs', 'node:os']);
});

test('an unanswered dynamic import rejects when it runs, comment or not', async () => {
  const api = await importIsolated('export const load = () => import // line\n("node:fs");');
  await assert.rejects(api.load(), /Unexpected dynamic import node:fs/);
});

test('comments around a static specifier or an export-from cannot reach an unlisted module', async () => {
  for (const source of ["import /* a */ { readFile } /* b */ from /* c */ 'node:fs';\nexport { readFile };",
    "import /* a */ 'node:fs';", "export * from /* a */ 'node:fs';", "export { readFile } from 'node:fs';"]) {
    await assert.rejects(importIsolated(source), /Unexpected import node:fs/, source);
  }
});

test('module syntax inside strings and comments is neither rewritten nor charged', async () => {
  const api = await importIsolated(
    "// import('node:fs') and import.meta\nexport const text = \"import x from 'node:fs'; import('node:os')\";");
  assert.equal(api.text, "import x from 'node:fs'; import('node:os')");
});

test('listed imports, globals and import.meta are bound exactly', async () => {
  const api = await importIsolated(
    "import value, { named } from './dep';\nexport const all = [value, named, injected, import /* m */ .meta.env.FLAG];",
    { imports: { './dep': { default: 'd', named: 'n' } }, globals: { injected: 'g' }, meta: { env: { FLAG: 'f' } } });
  assert.deepEqual(api.all, ['d', 'n', 'g', 'f']);
  await assert.rejects(importIsolated('export const m = import.meta;'), /Unexpected import\.meta/);
  await assert.rejects(importIsolated('export const = ;'), /Unparseable module/);
});
