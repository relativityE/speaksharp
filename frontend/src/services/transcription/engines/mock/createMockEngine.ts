import { ITranscriptionEngine, TranscriptionModeOptions } from '../../modes/types';
import { MockEngine } from '../MockEngine';

export function createMockEngine(
  options: TranscriptionModeOptions
): ITranscriptionEngine {
  return new MockEngine(options);
}
