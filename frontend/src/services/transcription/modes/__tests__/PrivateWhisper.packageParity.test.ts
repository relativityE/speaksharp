// @vitest-environment happy-dom
// Real product strategy and PCM stream; deterministic decoder double, NOT model accuracy proof.
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrivateWhisper from '../PrivateWhisper';
import { Result } from '../types';
import type { IPrivateSTT } from '@/contracts/IPrivateSTT';
import type { MicStream } from '../../utils/types';
import { PRIV_STT, PRIV_STT_DERIVED } from '../../sttConstants';

afterEach(()=>vi.useRealTimers());
describe('package evaluator uses product lifecycle semantics',()=>{
  it('drains an in-flight live decode, replaces it with the whole-utterance final and resets the second take',async()=>{
    vi.useFakeTimers();
    let releaseLive!: (result:ReturnType<typeof Result.ok<string>>) => void;
    let first=true;
    const calls:Array<{audio:Float32Array;final:boolean}>=[];
    const transcribe=vi.fn((audio:Float32Array,options?:{final?:boolean})=>{
      calls.push({audio:audio.slice(),final:options?.final===true});
      if(first&&!options?.final){first=false;return new Promise<ReturnType<typeof Result.ok<string>>>(resolve=>{releaseLive=resolve;});}
      return Promise.resolve(Result.ok(options?.final?'a complete authoritative utterance':'a live preview'));
    });
    const start=vi.fn(async()=>{});const stop=vi.fn(async()=>{});
    const decoder={init:vi.fn(async()=>Result.ok('transformers-js')),start,stop,transcribe,
      getEngineType:()=> 'transformers-js',getLiveResultKind:()=> 'incremental',
      getMetadata:()=>({candidateId:'fourth:compatible',engineVersion:'private_v2:fourth',modelName:'fourth',deviceType:'browser'})} as unknown as IPrivateSTT;
    const updates=vi.fn();
    const strategy=new PrivateWhisper({onTranscriptUpdate:updates,onReady:()=>{}},decoder);
    await strategy.init();
    let frame!: (pcm:Float32Array)=>void;
    const mic={state:'ready',sampleRate:16000,onFrame:(cb:typeof frame)=>{frame=cb;return()=>{};},offFrame:()=>{},stop:()=>{},close:()=>{}} as unknown as MicStream;
    await strategy.start(mic);
    const firstAudio=new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES*2).fill(0.4);
    frame(firstAudio);
    await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
    expect(calls.some(c=>!c.final)).toBe(true);expect(calls.some(c=>c.final)).toBe(false);
    const stopping=strategy.stop();await Promise.resolve();
    expect(calls.some(c=>c.final),'terminal inference waits for live inference').toBe(false);
    releaseLive(Result.ok('stale incomplete live result'));
    await vi.advanceTimersByTimeAsync(100);await stopping;
    const final=calls.filter(c=>c.final);expect(final).toHaveLength(1);
    expect(final[0].audio.length).toBe(firstAudio.length);
    expect(final[0].audio[0]).toBeCloseTo(0.4);
    expect(await strategy.getTranscript()).toBe('a complete authoritative utterance');
    expect(updates.mock.calls.some(([value])=>value.transcript.final==='a complete authoritative utterance'&&value.transcript.replacesRollingTranscript===true)).toBe(true);
    const count=calls.length;await strategy.stop();expect(calls.length).toBe(count);
    await strategy.start(mic);
    const secondAudio=new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES*2).fill(0.2);
    frame(secondAudio);await strategy.stop();
    const secondFinal=calls.filter(c=>c.final)[1];
    expect(secondFinal.audio.length).toBe(secondAudio.length);
    expect(secondFinal.audio[0]).toBeCloseTo(0.2);
    expect(start).toHaveBeenCalledTimes(2);expect(stop).toHaveBeenCalledTimes(2);
  });
});
