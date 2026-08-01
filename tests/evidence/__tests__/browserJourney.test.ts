import { describe, expect, it } from 'vitest';
import { classifyBrowserJourney } from '../browserJourney';

const base = () => ({
  speechApiAvailable: true,
  traceEvents: ['recognition_start_onstart', 'interim_candidate', 'final_candidate'],
  timerText: '00:03',
  transcript: 'clear browser speech',
  sessionProduced: true,
  executionMode: 'manual-assisted' as const,
  applicationServerWrites: 0,
  cloudProviderCalls: 0,
});

describe('#1037 Browser/Web Speech journey classification', () => {
  it('classifies a complete, actually-started journey as supported', () => {
    expect(classifyBrowserJourney(base())).toMatchObject({
      supportState: 'supported', recognitionStarted: true, timerAdvanced: true,
      transcriptProduced: true, sessionProduced: true,
    });
  });

  it('reports unavailable separately from a recording failure', () => {
    expect(classifyBrowserJourney({ ...base(), speechApiAvailable: false, traceEvents: [] }).supportState)
      .toBe('unavailable');
  });

  it.each(['recognition_start_onerror', 'recognition_start_throw', 'recognition_start_timeout'])(
    'reports %s as a start-failure, never supported',
    event => {
      expect(classifyBrowserJourney({ ...base(), traceEvents: [event], transcript: '', sessionProduced: false }).supportState)
        .toBe('start-failure');
    },
  );

  it('does not convert no speech, a zero timer, or a missing session into a passing journey', () => {
    const result = classifyBrowserJourney({ ...base(), timerText: '00:00', transcript: '', sessionProduced: false });
    expect(result.supportState).toBe('supported');
    expect(result.timerAdvanced).toBe(false);
    expect(result.transcriptProduced).toBe(false);
    expect(result.sessionProduced).toBe(false);
  });
});
