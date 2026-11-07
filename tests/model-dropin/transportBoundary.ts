import type { APIResponse, Route } from 'playwright';
import type { ComparisonBudget } from './comparisonBounds';
type Cache = {lookup(url:string):string|null;permits(url:string):boolean};
type Admission = Pick<ComparisonBudget,'admit'|'admitCachedAsset'|'rejectTransport'>;
/** All actual transport uses maxRedirects:0. No route.continue or browser-visible model redirect. */
export async function fetchAdmittedResponse(route: Route, budget: Admission, cache?: Cache): Promise<APIResponse> {
  const request=route.request();const url=request.url();
  let options: Parameters<Route['fetch']>[0] = {maxRedirects:0,maxRetries:0,timeout:30_000};
  const cached=request.method()==='GET'?cache?.lookup(url):null;
  if(cached){
    if(!cache?.permits(cached))return budget.rejectTransport('bounded_transport_error');
    // Count original pinned request AND the explicit cache transfer. Neither hop is an automatic redirect.
    budget.admitCachedAsset();budget.admitCachedAsset();
    const range=request.headers()['range'];
    if(range&&!/^bytes=\d+-\d+$/.test(range))return budget.rejectTransport('bounded_transport_error');
    options={...options,url:cached,method:'GET',headers:range?{range}:{}};
  }else if(request.method()==='GET'&&cache?.permits(url))budget.admitCachedAsset();
  else{
    let body:unknown;try{body=request.postDataJSON();}catch{/* GET/no JSON */}
    budget.admit({url,method:request.method(),body,preflightMethod:request.headers()['access-control-request-method']});
  }
  const response=await route.fetch(options);
  if(response.status()>=300&&response.status()<400){await response.dispose();return budget.rejectTransport('bounded_redirect_refused');}
  return response;
}
