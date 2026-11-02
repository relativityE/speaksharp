import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import coachingContract from '../contract.json' with { type: 'json' };
import { descriptorUrl, InvalidProviderDescriptorError, parseProviderDescriptor, PROVIDER_CATALOG } from './catalog.ts';

const valid = {
  id: 'google_gemini',
  family: 'gemini-generate-content',
  model: 'gemini-3.8-flash',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
  keyVariable: 'GEMINI_API_KEY',
};

Deno.test('the reviewed Gemini descriptor is unchanged by the split: contract.json model, same endpoint and key NAME', () => {
  assertEquals(PROVIDER_CATALOG.length, 1);
  const [gemini] = PROVIDER_CATALOG;
  assertEquals(gemini.model, coachingContract.model);
  assertEquals(descriptorUrl(gemini), `https://generativelanguage.googleapis.com/v1beta/models/${coachingContract.model}:generateContent`);
  assertEquals(gemini.keyVariable, 'GEMINI_API_KEY');
  assertEquals(Object.isFrozen(gemini), true);
  assertEquals(Object.isFrozen(PROVIDER_CATALOG), true);
});

Deno.test('a valid descriptor parses to a frozen copy with exactly the declared fields', () => {
  const parsed = parseProviderDescriptor({ ...valid });
  assertEquals(parsed, valid);
  assertEquals(Object.isFrozen(parsed), true);
});

Deno.test('every malformed descriptor refuses with a closed code that never echoes the value', () => {
  const secretish = 'AIzaSy-not-a-real-key';
  const cases: Array<[unknown, string]> = [
    [null, 'DESCRIPTOR_NOT_OBJECT'],
    [[valid], 'DESCRIPTOR_NOT_OBJECT'],
    [{ ...valid, apiKey: secretish }, 'DESCRIPTOR_FIELDS_INVALID'],
    [{ id: valid.id, family: valid.family, model: valid.model, endpoint: valid.endpoint }, 'DESCRIPTOR_FIELDS_INVALID'],
    [{ ...valid, id: 'Google-Gemini' }, 'DESCRIPTOR_ID_INVALID'],
    [{ ...valid, family: 'openai-chat' }, 'DESCRIPTOR_FAMILY_UNSUPPORTED'],
    [{ ...valid, model: '../escape model' }, 'DESCRIPTOR_MODEL_INVALID'],
    [{ ...valid, keyVariable: secretish }, 'DESCRIPTOR_KEY_VARIABLE_INVALID'],
    [{ ...valid, endpoint: 'http://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent' }, 'DESCRIPTOR_ENDPOINT_INVALID'],
    [{ ...valid, endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent' }, 'DESCRIPTOR_ENDPOINT_INVALID'],
    [{ ...valid, endpoint: 'https://x.test/{model}/{model}' }, 'DESCRIPTOR_ENDPOINT_INVALID'],
    [{ ...valid, endpoint: 'https://x.test/{model}?key=' + secretish }, 'DESCRIPTOR_ENDPOINT_INVALID'],
    [{ ...valid, endpoint: 'https://user:pass@x.test/{model}' }, 'DESCRIPTOR_ENDPOINT_INVALID'],
    [{ ...valid, endpoint: 'https://x.test/{model}#frag' }, 'DESCRIPTOR_ENDPOINT_INVALID'],
    [{ ...valid, endpoint: 'not a url {model}' }, 'DESCRIPTOR_ENDPOINT_INVALID'],
  ];
  for (const [input, code] of cases) {
    const error = assertThrows(() => parseProviderDescriptor(input), InvalidProviderDescriptorError);
    assertEquals(error.message, code, JSON.stringify(input));
    assertEquals(error.message.includes(secretish), false);
  }
});
