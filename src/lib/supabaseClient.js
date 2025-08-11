import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://yxlapjuovrsvjswkwnrk.supabase.co';
const supabaseAnonKey = 'sb_publishable_VGLwFdNVadwyuiaabJY0dQ_FbFml1oN';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
