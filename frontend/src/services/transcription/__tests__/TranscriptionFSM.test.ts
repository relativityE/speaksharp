import { describe, expect, it } from 'vitest';
import { TranscriptionFSM } from '../TranscriptionFSM';

describe('TranscriptionFSM', () => {
  it('allows a first-use private model cache miss to recover from FAILED into DOWNLOAD_REQUIRED', () => {
    const fsm = new TranscriptionFSM('FAILED');

    const transitioned = fsm.transition({ type: 'DOWNLOAD_REQUIRED' });

    expect(transitioned).toBe(true);
    expect(fsm.getState()).toBe('DOWNLOAD_REQUIRED');
  });

  it('does not allow downloading bytes to skip directly to ready', () => {
    const fsm = new TranscriptionFSM('DOWNLOADING');

    const transitioned = fsm.transition({ type: 'ENGINE_INIT_SUCCESS' });

    expect(transitioned).toBe(false);
    expect(fsm.getState()).toBe('DOWNLOADING');
  });

  it('represents private model initialization failure as a recoverable setup state', () => {
    const fsm = new TranscriptionFSM('ENGINE_INITIALIZING');

    const transitioned = fsm.transition({ type: 'INIT_FAILED', error: new Error('WASM init failed') });

    expect(transitioned).toBe(true);
    expect(fsm.getState()).toBe('INIT_FAILED');
    expect(fsm.transition({ type: 'ENGINE_INIT_REQUESTED' })).toBe(true);
    expect(fsm.getState()).toBe('ENGINE_INITIALIZING');
  });
});
