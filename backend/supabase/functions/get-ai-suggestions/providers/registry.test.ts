import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { geminiProvider } from './gemini.ts';
import { PERSISTABLE_PROVIDER_IDS, PROVIDERS, SELECTED_PROVIDER_ID, selectProvider } from './registry.ts';
import type { CoachingProvider } from './types.ts';

const offline: CoachingProvider = {
  id: 'offline_double',
  keyVariable: 'OFFLINE_DOUBLE_KEY',
  attempt: () => Promise.reject(new Error('never called by the registry')),
};

Deno.test('Gemini is the reviewed default and the only provider the database can persist today', () => {
  assertEquals(SELECTED_PROVIDER_ID, 'google_gemini');
  assertEquals(selectProvider(SELECTED_PROVIDER_ID), geminiProvider);
  assertEquals([...PERSISTABLE_PROVIDER_IDS], ['google_gemini']);
  assertEquals(Object.keys(PROVIDERS), ['google_gemini']);
  assertEquals(Object.isFrozen(PROVIDERS), true);
  assertEquals(geminiProvider.keyVariable, 'GEMINI_API_KEY');
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
