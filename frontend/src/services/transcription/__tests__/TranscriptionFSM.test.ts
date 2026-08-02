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

  // #1089 same-turn double-action: a rapid second Stop, or a Start, during finalization must not
  // produce a second stop or a restart. At the FSM layer STOPPING has exactly one legitimate forward
  // exit (STOP_COMPLETED→READY); every other action a double-click could send is rejected.
  it('#1089: a second STOP_REQUESTED from STOPPING is a no-op (single stop/finalize)', () => {
    const fsm = new TranscriptionFSM('RECORDING');
    expect(fsm.transition({ type: 'STOP_REQUESTED' })).toBe(true);
    expect(fsm.getState()).toBe('STOPPING');
    expect(fsm.transition({ type: 'STOP_REQUESTED' })).toBe(false); // no second stop
    expect(fsm.getState()).toBe('STOPPING');
  });

  it('#1089: no restart is possible from STOPPING (START_REQUESTED / ENGINE_STARTED rejected)', () => {
    const fsm = new TranscriptionFSM('STOPPING');
    expect(fsm.transition({ type: 'START_REQUESTED' })).toBe(false);
    expect(fsm.transition({ type: 'ENGINE_STARTED' })).toBe(false);
    expect(fsm.getState()).toBe('STOPPING'); // zero restart while finalizing
  });
});
