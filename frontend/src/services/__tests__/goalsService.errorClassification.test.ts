import {afterEach, describe, expect, it, vi} from 'vitest';
import {createSupabaseErrorMock, createSupabaseNotFoundMock} from '../../../tests/utils/supabase-mock';
import * as supabaseModule from '@/lib/supabaseClient';
import {goalsService} from '../domainServices';

afterEach(()=>vi.restoreAllMocks());

describe('goals read failure classification',()=>{
    it.each(['42501','403'])('preserves privilege failure %s instead of claiming no goal exists',async code=>{
        const client=createSupabaseErrorMock(code,'permission denied for table user_goals');
        vi.spyOn(supabaseModule,'getSupabaseClient').mockReturnValue(client);
        await expect(goalsService.get('synthetic-user-a')).rejects.toMatchObject({code});
    });
    it('retains the genuine missing-row result',async()=>{
        vi.spyOn(supabaseModule,'getSupabaseClient').mockReturnValue(createSupabaseNotFoundMock());
        await expect(goalsService.get('synthetic-user-a')).resolves.toBeNull();
    });
});
