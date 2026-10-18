import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '../../../../tests/support/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AISuggestions from '../AISuggestions';
import { SessionOverhaulView } from '../SessionOverhaulView';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useSessionStore } from '@/stores/useSessionStore';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { __resetPracticeLoopTelemetryForTests } from '@/services/telemetry/practiceLoopTelemetry';
import { __resetJourneyIdentityForTests, beginJourney } from '@/services/telemetry/journeyIdentity';
import { __resetCompletionStagesForTests } from '@/services/telemetry/completionStages';
vi.mock('@/lib/supabaseClient');
const invoke = vi.fn();
const path = (pathname: string) => { (window.location as unknown as {pathname: string}).pathname = pathname; };
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(r => { resolve = r; });
  return { promise, resolve };
};
let push: ReturnType<typeof vi.spyOn>;
const events = () => push.mock.calls.filter(c => c[0] === 'ai_coaching_lifecycle').map(c => c[1] as Record<string,unknown>);
const ends = () => events().filter(e => e.stage === 'ended').map(e => e.end_reason);
const afterTick = async () => { await act(async () => { await new Promise(r => setTimeout(r, 15)); }); };
beforeEach(() => {
  path('/session'); invoke.mockReset();
  vi.mocked(getSupabaseClient).mockReturnValue({functions: {invoke}} as unknown as ReturnType<typeof getSupabaseClient>);
  __resetPracticeLoopTelemetryForTests(); __resetJourneyIdentityForTests(); __resetCompletionStagesForTests(); beginJourney();
  push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
  useSessionStore.getState().setProgressGate(null);
  useSessionStore.getState().setProgressGateResolvedFor('user-1');
});
describe('Browser PM independent settlement-order controls on exact published source', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(async () => {
    cleanup();
    await act(async () => { vi.advanceTimersByTime(0); });
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  const cases = (['repeat', 'exit', 'repeat-then-exit'] as const).flatMap(boundary =>
    (['success', 'transport-error'] as const).flatMap(response =>
      (['before-tick', 'after-tick'] as const).map(order => ({ boundary, response, order }))));
  it.each(cases)('$boundary / $response / $order preserves captured retirement and one terminal', async ({ boundary, response, order }) => {
    let signal: AbortSignal | undefined;
    const answer = deferred();
    invoke.mockImplementationOnce((_name: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return answer.promise;
    });
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(boundary === 'exit'
        ? <AISuggestions transcript="synthetic take" canReview sessionId="take-a" />
        : <RealShell />);
      for (let n = 0; n < 10; n += 1) await Promise.resolve();
    });
    expect(signal).toBeDefined();
    if (boundary === 'exit') {
      path('/analytics');
      view.unmount();
    } else {
      fireEvent.click(screen.getByTestId('verdict-practice-again'));
      expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
      if (boundary === 'repeat-then-exit') {
        path('/analytics');
        view.unmount();
      }
    }
    if (order === 'after-tick') await act(async () => { vi.advanceTimersByTime(0); });
    await act(async () => {
      answer.resolve(response === 'success'
        ? { data: { suggestions: { version: 'gemini_coaching_v1', what_worked: 'Late synthetic worked.', what_to_try_next: 'Late synthetic next.' } }, error: null }
        : { data: null, error: { name: 'FunctionsFetchError', message: 'synthetic transport error' } });
      for (let n = 0; n < 15; n += 1) await Promise.resolve();
    });
    const expectedReason = boundary === 'exit' ? 'unmounted' : 'superseded_session';
    const observedBeforeDrain = ends();
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(ends(), JSON.stringify({ boundary, response, order, observedBeforeDrain })).toEqual([expectedReason]);
    expect(signal!.aborted).toBe(boundary === 'exit' && order === 'after-tick');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(events().some(e => e.stage === 'ready' || e.stage === 'rendered' || e.stage === 'persisted')).toBe(false);
    expect(screen.queryByText('Late synthetic next.')).toBeNull();
    expect(events().some(e => e.stage === (response === 'success' ? 'response_received' : 'transport_failed'))).toBe(true);
  });
});
afterEach(async () => { cleanup(); await afterTick(); push.mockRestore(); });
const base = {
  authUserId: 'user-1', sttStatus: {type: 'idle' as const}, elapsedTime: 0, micLevel: 0,
  transcriptContent: 'synthetic take', metricsFillerCount: 0, history: [],
  reviewTranscript: {kind: 'available' as const, text: 'synthetic take'},
};
function RealShell() {
  const [recording, setRecording] = useState(false);
  return <SessionOverhaulView {...base} isListening={recording} showAnalyticsPrompt={!recording}
    onStartStop={() => { useSessionStore.setState({captureLive: true}); setRecording(true); }}
    practiceLoopReview={<AISuggestions transcript="synthetic take" canReview sessionId="take-a" />} />;
}
describe('Browser PM independent #1661 boundary probes (real components, mocked transport only)', () => {
  it('REAL TREE repeat while pending unmounts review without abort, retry or stale UI', async () => {
    let signal: AbortSignal | undefined;
    const answer = deferred();
    invoke.mockImplementationOnce((_name: string, options: {signal: AbortSignal}) => { signal=options.signal; return answer.promise; });
    render(<RealShell />);
    await waitFor(() => expect(signal).toBeDefined());
    expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state','after');
    fireEvent.click(screen.getByTestId('verdict-practice-again'));
    expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state','during');
    expect(screen.queryByTestId('ai-suggestions-card')).toBeNull();
    await afterTick();
    expect(signal!.aborted).toBe(false); expect(ends()).toEqual(['superseded_session']);
    await act(async () => { answer.resolve({data:{suggestions:{version:'gemini_coaching_v1',what_worked:'Late synthetic worked.',what_to_try_next:'Late synthetic next.'}},error:null}); });
    await waitFor(() => expect(events().some(e => e.stage==='response_received')).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(events().some(e => e.stage==='ready'||e.stage==='rendered')).toBe(false);
    expect(screen.queryByText('Late synthetic next.')).toBeNull();
    expect(ends()).toEqual(['superseded_session']);
  });
  it('ID retirement before same-page unmount preserves the accepted request', async () => {
    let signal: AbortSignal | undefined;
    invoke.mockImplementationOnce((_name: string, options: {signal: AbortSignal}) => {signal=options.signal;return new Promise(()=>{});});
    const view=render(<AISuggestions transcript="synthetic take" canReview sessionId="take-a"/>);
    await waitFor(()=>expect(signal).toBeDefined());
    view.rerender(<AISuggestions transcript="" canReview={false} sessionId={undefined}/>);
    view.unmount(); await afterTick();
    expect(signal!.aborted).toBe(false); expect(ends()).toEqual(['superseded_session']);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('StrictMode replay keeps one pending request alive with no false terminal', async () => {
    let signal: AbortSignal | undefined;
    invoke.mockImplementationOnce((_name: string, options: {signal: AbortSignal})=>{signal=options.signal;return new Promise(()=>{});});
    render(<React.StrictMode><AISuggestions transcript="synthetic take" canReview sessionId="take-a"/></React.StrictMode>);
    await waitFor(()=>expect(signal).toBeDefined()); await afterTick();
    expect(signal!.aborted).toBe(false); expect(ends()).toEqual([]); expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('ordinary route exit aborts the active request exactly once', async () => {
    let signal: AbortSignal | undefined;
    invoke.mockImplementationOnce((_name:string,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(()=>{});});
    const view=render(<AISuggestions transcript="synthetic take" canReview sessionId="take-a"/>);
    await waitFor(()=>expect(signal).toBeDefined());
    path('/analytics'); view.unmount(); await afterTick();
    expect(signal!.aborted).toBe(true); expect(ends()).toEqual(['unmounted']);
    expect(events().find(e=>e.stage==='ended')?.client_aborted).toBe(true);
  });
  it('already-superseded same-page request remains unaborted on a later route exit', async () => {
    let signal:AbortSignal|undefined;
    invoke.mockImplementationOnce((_name:string,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(()=>{});});
    const view=render(<AISuggestions transcript="synthetic take" canReview sessionId="take-a"/>);
    await waitFor(()=>expect(signal).toBeDefined());
    view.unmount(); await afterTick(); path('/analytics'); await afterTick();
    expect(signal!.aborted).toBe(false); expect(ends()).toEqual(['superseded_session']);
  });
  it('COUNTEREXAMPLE: route exit then immediate return before deferred cleanup must still abort active A', async () => {
    let signal:AbortSignal|undefined;
    invoke.mockImplementationOnce((_name:string,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(()=>{});});
    const view=render(<AISuggestions transcript="synthetic take" canReview sessionId="take-a"/>);
    await waitFor(()=>expect(signal).toBeDefined());
    path('/analytics'); view.unmount(); path('/session'); await afterTick();
    expect(signal!.aborted, 'an actual exit cannot be erased by a return before setTimeout(0)').toBe(true);
    expect(ends()).toEqual(['unmounted']);
  });
  it('COUNTEREXAMPLE: real-tree repeat followed by immediate route exit must not abort superseded A', async () => {
    let signal:AbortSignal|undefined;
    invoke.mockImplementationOnce((_name:string,options:{signal:AbortSignal})=>{signal=options.signal;return new Promise(()=>{});});
    const view=render(<RealShell/>); await waitFor(()=>expect(signal).toBeDefined());
    fireEvent.click(screen.getByTestId('verdict-practice-again'));
    expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state','during');
    path('/analytics'); view.unmount(); await afterTick();
    expect(signal!.aborted, 'the repeat superseded A before the later route exit').toBe(false);
    expect(ends()).toEqual(['superseded_session']);
  });
});

