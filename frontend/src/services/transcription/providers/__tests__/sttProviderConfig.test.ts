import { describe, expect, it } from 'vitest';
import {
  getDefaultProviderEntry,
  getDefaultProviderForMode,
  getProviderEntry,
  getProviderIdsForMode,
  getRegistryKeyForMode,
} from '../sttProviderConfig';

describe('STT provider config', () => {
  it('keeps mode defaults in the canonical provider config', () => {
    expect(getDefaultProviderForMode('native')).toBe('auto-browser');
    expect(getDefaultProviderForMode('private')).toBe('transformers-js');
    expect(getDefaultProviderForMode('cloud')).toBe('assemblyai');
  });

  it('maps mode defaults to the registry or factory key used at runtime', () => {
    expect(getRegistryKeyForMode('native')).toBe('native-browser');
    expect(getRegistryKeyForMode('private')).toBe('transformers-js');
    expect(getRegistryKeyForMode('cloud')).toBe('assemblyai');
  });

  it('lists current private providers as equal config-selectable implementations', () => {
    expect(getProviderIdsForMode('private')).toEqual([
      'transformers-js',
      'transformers-js-v4',
      'whisper-turbo',
    ]);
  });

  it('keeps future cloud providers selectable but unavailable until implemented', () => {
    const entry = getProviderEntry('cloud', 'deepgram');
    expect(entry).toMatchObject({
      id: 'deepgram',
      status: 'future',
    });
    expect(entry?.registryKey).toBeUndefined();
  });

  it('throws if a configured default provider is missing from its mode inventory', () => {
    const entry = getDefaultProviderEntry('cloud');
    expect(entry).toMatchObject({
      id: 'assemblyai',
      registryKey: 'assemblyai',
    });
  });
});
