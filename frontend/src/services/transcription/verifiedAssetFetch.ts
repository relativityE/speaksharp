/** Shared model-response verification. The caller owns consent and egress policy. */
export interface AssetResponsePin { url: string; sha256: string; bytes?: number }
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
    .map(n=>n.toString(16).padStart(2,'0')).join('');
export function createVerifiedAssetFetch(pins: readonly AssetResponsePin[], scopes: readonly string[],
    upstream: typeof fetch, storage: CacheStorage | undefined = typeof caches==='undefined'?undefined:caches): typeof fetch {
    const inventory = new Map(pins.map(pin=>[pin.url,pin]));
    if(!pins.length || inventory.size!==pins.length || pins.some(p=>!/^[a-f0-9]{64}$/.test(p.sha256))) throw Error('MODEL_RESPONSE_PINS_INVALID');
    return async (input: RequestInfo | URL, init?: RequestInit) => {
        const raw=input instanceof Request?input.url:input.toString();
        const url=new URL(raw,globalThis.location?.href).href;
        const pin=inventory.get(url);
        if(!pin){
            if(scopes.some(prefix=>url.startsWith(prefix))) throw Error('UNPINNED_MODEL_RESPONSE');
            return upstream(input,init);
        }
        if((init?.method??(input instanceof Request?input.method:'GET'))!=='GET')throw Error('MODEL_RESPONSE_METHOD_UNSUPPORTED');
        // Re-verify cached responses as well; never fall through to network after a corrupt cache hit.
        const cached=await storage?.match(url);
        const response=cached??await upstream(input,init);
        if(!response.ok)throw Error('MODEL_RESPONSE_FAILED');
        const body=await response.arrayBuffer();
        if((pin.bytes!==undefined&&body.byteLength!==pin.bytes)||await digest(body)!==pin.sha256)throw Error('MODEL_RESPONSE_INTEGRITY_FAILED');
        const headers=new Headers(response.headers);headers.delete('content-encoding');headers.set('content-length',String(body.byteLength));
        const verified=new Response(body,{status:response.status,statusText:response.statusText,headers});
        Object.defineProperty(verified,'url',{value:response.url||url});
        if(!cached && storage){const cache=await storage.open('speaksharp-verified-model-v1');await cache.put(url,verified.clone());}
        return verified;
    };
}
/** Main-thread ownership restoration must not remove a newer load's guard. */
export function installVerifiedAssetFetch(pins: readonly AssetResponsePin[], scopes: readonly string[]) {
    const previous=globalThis.fetch;
    const guarded=createVerifiedAssetFetch(pins,scopes,previous.bind(globalThis));
    globalThis.fetch=guarded;
    return ()=>{if(globalThis.fetch===guarded)globalThis.fetch=previous;};
}
