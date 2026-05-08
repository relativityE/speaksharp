import { describe, expect, it } from 'vitest';
import { TranscriptionFSM } from '../TranscriptionFSM';

describe('TranscriptionFSM', () => {
  it('allows a first-use private model cache miss to recover from FAILED into DOWNLOAD_REQUIRED', () => {
    const fsm = new TranscriptionFSM('FAILED');

    const transitioned = fsm.transition({ type: 'DOWNLOAD_REQUIRED' });

    expect(transitioned).toBe(true);
    expect(fsm.getState()).toBe('DOWNLOAD_REQUIRED');
  });
});
