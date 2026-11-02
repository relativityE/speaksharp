import { assertEquals, assertStrictEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { PROVIDER_CATALOG, type ProviderDescriptor } from './catalog.ts';
import { GEMINI_API_URL } from './gemini.ts';
import { ADAPTERS, buildProviders, PERSISTABLE_PROVIDER_IDS, PROVIDERS, SELECTED_PROVIDER_ID, selectProvider } from './registry.ts';
import type { CoachingProvider } from './types.ts';

const offline: CoachingProvider = {
  id: 'offline_double',
  keyVariable: 'OFFLINE_DOUBLE_KEY',
  attempt: () => Promise.reject(new Error('never called by the registry')),
};

Deno.test('Gemini is the reviewed default and the only provider the database can persist today', () => {
  assertEquals(SELECTED_PROVIDER_ID, 'google_gemini');
  assertStrictEquals(selectProvider(SELECTED_PROVIDER_ID), PROVIDERS.google_gemini);
  assertEquals([...PERSISTABLE_PROVIDER_IDS], ['google_gemini']);
  assertEquals(Object.keys(PROVIDERS), ['google_gemini']);
  assertEquals(Object.isFrozen(PROVIDERS), true);
  assertEquals(PROVIDERS.google_gemini.keyVariable, 'GEMINI_API_KEY');
  assertEquals(Object.keys(ADAPTERS), ['gemini-generate-content']);
  assertEquals(PROVIDER_CATALOG.map((d) => d.id), Object.keys(PROVIDERS), 'every shipped adapter is built from a catalogued descriptor');
});

Deno.test('the catalogue builds through installed families and refuses a duplicate, an uninstalled family or a mismatched adapter', () => {
  const gemini = PROVIDER_CATALOG[0];
  const second: ProviderDescriptor = { ...gemini, id: 'google_gemini_alt', model: 'gemini-alt-model' };
  // A second descriptor of an INSTALLED family needs no new code: it is built, and only its data differs.
  const built = buildProviders([gemini, second]);
  assertEquals(Object.keys(built), ['google_gemini', 'google_gemini_alt']);
  assertEquals(built.google_gemini_alt.keyVariable, gemini.keyVariable);
  assertEquals(selectProvider('google_gemini_alt', built), null, 'built, but the database cannot persist it, so it is not selectable');
  assertThrows(() => buildProviders([gemini, gemini]), Error, 'duplicate id');
  assertThrows(() => buildProviders([gemini], {}), Error, 'no installed adapter');
  assertThrows(() => buildProviders([gemini], { 'gemini-generate-content': () => offline }), Error, 'does not match descriptor');
  assertEquals(GEMINI_API_URL, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
});

Deno.test('a missing, non-string, unknown or prototype-named selection resolves to nothing', () => {
  for (const configured of [undefined, null, '', 42, {}, ['google_gemini'], 'GOOGLE_GEMINI', 'openai', 'toString', '__proto__', 'constructor']) {
    assertEquals(selectProvider(configured), null, String(configured));
  }
});

Deno.test('a shipped adapter the database cannot persist is refused, and an adapter filed under another id is refused', () => {
  assertEquals(selectProvider('offline_double', { ...PROVIDERS, offline_double: offline }), null, 'shipped but not persistable');
  assertEquals(selectProvider('offline_double', { offline_double: offline }, new Set(['offline_double'])), offline);
  assertEquals(selectProvider('google_gemini', { google_gemini: offline }, new Set(['google_gemini'])), null, 'id mismatch');
});
