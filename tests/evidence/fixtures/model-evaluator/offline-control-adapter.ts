// Deterministic command-integration seam. No model/browser/provider acquisition.
import { createHash } from 'node:crypto';
import type { AdapterFactory } from '../../../../scripts/model-evaluator/adapter';
export const createAdapter:AdapterFactory=context=>{
  let pcm:Float32Array|null=null;
  return {
    async initialize(){
      if(context.options.initFailure)throw new Error('offline_init_failure');
      return {...context.expected,backend:typeof context.options.observedBackend==='string'?context.options.observedBackend:context.expected.backend};
    },
    async decode(input){if(context.options.decodeFailure)throw new Error('offline_decode_failure');pcm=input.slice();},
    async finalize(){
      if(!pcm)throw new Error('no_control_input');
      return {transcript:'hello world',inputSha256:createHash('sha256').update(Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength)).digest('hex')};
    },
    async dispose(){if(context.options.disposeFailure)throw new Error('offline_dispose_failure');pcm=null;},
  };
};
