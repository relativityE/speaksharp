import { describe, expect, it } from 'vitest';
import {
  getDefaultProviderForMode,
  getProviderIdsForMode,
  getRegistryKeyForMode,
} from '../sttProviderConfig';

describe('STT provider config', () => {
  it('keeps mode defaults in the canonical provider config', () => {
    // #1320: Native/Web-Speech is retired — Private is the only mode in the config.
    expect(getDefaultProviderForMode('private')).toBe('transformers-js');
  });

  it('maps mode defaults to the registry or factory key used at runtime', () => {
    expect(getRegistryKeyForMode('private')).toBe('transformers-js');
  });

  it('lists current private providers as equal config-selectable implementations', () => {
    expect(getProviderIdsForMode('private')).toEqual([
      'transformers-js',
      'transformers-js-v4',
      'moonshine-streaming',
    ]);
  });


});
