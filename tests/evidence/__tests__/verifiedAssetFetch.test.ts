// Real response bodies and real SHA-256; no model/network/browser execution.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { createVerifiedAssetFetch } from '../../../frontend/src/services/transcription/verifiedAssetFetch';
const url='https://huggingface.co/example/model/resolve/main/model.onnx';
const sha=(body:string)=>createHash('sha256').update(body).digest('hex');
afterEach(()=>vi.unstubAllGlobals());
describe('verified response boundary',()=>{
  it('refuses substituted network and cached bodies, with no corrupt-cache network fallback',async()=>{
    vi.stubGlobal('crypto',webcrypto);
    const network=vi.fn(async()=>new Response('wrong'));
    const pins=[{url,sha256:sha('right'),bytes:5}];
    const uncached=createVerifiedAssetFetch(pins,['https://huggingface.co/example/model/'],network,undefined);
    await expect(uncached(url)).rejects.toThrow('MODEL_RESPONSE_INTEGRITY_FAILED');expect(network).toHaveBeenCalledTimes(1);
    const storage={match:vi.fn(async()=>new Response('wrong')),open:vi.fn()} as unknown as CacheStorage;
    const cached=createVerifiedAssetFetch(pins,['https://huggingface.co/example/model/'],network,storage);
    await expect(cached(url)).rejects.toThrow('MODEL_RESPONSE_INTEGRITY_FAILED');expect(network).toHaveBeenCalledTimes(1);
  });
  it('accepts exact bytes at a mutable URL and refuses missing scoped pins before transport',async()=>{
    vi.stubGlobal('crypto',webcrypto);
    const network=vi.fn(async()=>new Response('right'));
    const guarded=createVerifiedAssetFetch([{url,sha256:sha('right'),bytes:5}],['https://huggingface.co/example/model/'],network,undefined);
    expect(await (await guarded(url)).text()).toBe('right');
    await expect(guarded(url+'-unreviewed')).rejects.toThrow('UNPINNED_MODEL_RESPONSE');
    expect(network).toHaveBeenCalledTimes(1);
    await expect(guarded(url,{method:'POST'})).rejects.toThrow('MODEL_RESPONSE_METHOD_UNSUPPORTED');
  });
});
