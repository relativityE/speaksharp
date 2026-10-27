import React from 'react';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useAuthProvider} from '@/contexts/AuthProvider';
import {goalsService} from '@/services/domainServices';
import {useGoals, DEFAULT_GOALS} from '../useGoals';

vi.mock('@/contexts/AuthProvider',()=>({useAuthProvider:vi.fn()}));
vi.mock('@/services/domainServices',()=>({goalsService:{get:vi.fn(),upsert:vi.fn()}}));
const a={weeklyGoal:11,clarityGoal:96},b={weeklyGoal:3,clarityGoal:88};
const key='speaksharp:user-goals';
let client: QueryClient;
function owner(id:string|null) {
    vi.mocked(useAuthProvider).mockReturnValue({user:id?{id}:null} as ReturnType<typeof useAuthProvider>);
}
function wrapper({children}:{children:React.ReactNode}) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(()=>{
    localStorage.clear();vi.resetAllMocks();owner('synthetic-a');
    client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
});
afterEach(()=>{cleanup();client.clear();localStorage.clear();});

describe('actual goals hook keeps fallback data bound to its account',()=>{
    it('exposes an unavailable account read while showing only that account fallback',async()=>{
        const error=Object.assign(new Error('permission denied'),{code:'42501'});
        vi.mocked(goalsService.get).mockRejectedValue(error);
        localStorage.setItem('speaksharp:user-goals:user:synthetic-a',JSON.stringify(a));
        const {result}=renderHook(()=>useGoals(),{wrapper});
        await waitFor(()=>expect(result.current.syncError).toBe(error));
        expect(result.current.goals).toEqual(a);
        expect(goalsService.get).toHaveBeenCalledTimes(1);
    });
    it('does not import anonymous preferences into a signed-in account without a saved goal',async()=>{
        localStorage.setItem(key,JSON.stringify(a));vi.mocked(goalsService.get).mockResolvedValue(null);
        const {result}=renderHook(()=>useGoals(),{wrapper});
        await waitFor(()=>expect(result.current.isLoading).toBe(false));
        expect(result.current.goals).toEqual(DEFAULT_GOALS);
    });
    it('does not reuse account A goals for account B with no saved goals',async()=>{
        vi.mocked(goalsService.get).mockImplementation(async id=>id==='synthetic-a'?a:null);
        const {result,rerender}=renderHook(()=>useGoals(),{wrapper});
        await waitFor(()=>expect(result.current.goals).toEqual(a));
        owner('synthetic-b');rerender();
        await waitFor(()=>expect(goalsService.get).toHaveBeenCalledWith('synthetic-b'));
        await waitFor(()=>expect(result.current.isLoading).toBe(false));
        expect(result.current.goals).toEqual(DEFAULT_GOALS);
    });
    it('does not expose signed-in goals after logout into anonymous storage',async()=>{
        vi.mocked(goalsService.get).mockResolvedValue(a);
        const {result,rerender}=renderHook(()=>useGoals(),{wrapper});
        await waitFor(()=>expect(result.current.goals).toEqual(a));
        owner(null);rerender();
        await waitFor(()=>expect(result.current.isLoading).toBe(false));
        expect(result.current.goals).toEqual(DEFAULT_GOALS);
        expect(localStorage.getItem(key)).toBeNull();
    });
    it('a late account-A read cannot populate anonymous storage after switching accounts',async()=>{
        let resolveA!:(value:typeof a)=>void;
        vi.mocked(goalsService.get).mockImplementation(id=>id==='synthetic-a'?new Promise(resolve=>{resolveA=resolve;}):Promise.resolve(null));
        const {result,rerender}=renderHook(()=>useGoals(),{wrapper});
        await waitFor(()=>expect(goalsService.get).toHaveBeenCalledWith('synthetic-a'));
        owner('synthetic-b');rerender();
        await waitFor(()=>expect(result.current.isLoading).toBe(false));
        await act(async()=>resolveA(a));
        expect(localStorage.getItem(key)).toBeNull();
        expect(result.current.goals).toEqual(DEFAULT_GOALS);
    });
    it('a late account-A save cannot replace account B goals',async()=>{
        let resolveSave!:(value:typeof a)=>void;
        vi.mocked(goalsService.get).mockImplementation(async id=>id==='synthetic-a'?a:b);
        vi.mocked(goalsService.upsert).mockImplementation(()=>new Promise(resolve=>{resolveSave=resolve;}));
        const {result,rerender}=renderHook(()=>useGoals(),{wrapper});
        await waitFor(()=>expect(result.current.goals).toEqual(a));
        let save!:Promise<unknown>;
        act(()=>{save=result.current.setGoals(a);});
        await waitFor(()=>expect(goalsService.upsert).toHaveBeenCalledWith('synthetic-a',a));
        owner('synthetic-b');rerender();
        await waitFor(()=>expect(result.current.goals).toEqual(b));
        await act(async()=>{resolveSave(a);await save;});
        expect(result.current.goals).toEqual(b);
    });
});
