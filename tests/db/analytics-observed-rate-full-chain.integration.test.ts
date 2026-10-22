// @vitest-environment node
// Executes the exact new postflight SQL against a bounded PGlite schema, not native/full-chain qualification.
import {describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const read=(name:string)=>readFileSync(name,'utf8');
async function fixture(observed:boolean) {
  const db=new PGlite();
  await db.exec(read('tests/db/analytics-summary-bootstrap.sql'));
  await db.exec('ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN email_confirmed_at timestamptz; ALTER TABLE public.sessions ADD COLUMN product text;');
  for(const name of ['20260816223606_metrics_only_additive_1306.sql','20260817140000_repoint_analytics_summary_flat_1306.sql',
    ...(observed?['20261018090000_analytics_summary_observed_filler_rate_1472.sql']:[])]) {
    await db.exec(read('backend/supabase/migrations/'+name));
  }
  return db;
}
describe('same full-chain Analytics SQL postflight has an independent rate oracle',()=>{
  it('passes observed-rate SQL and rolls back its own Auth/session fixtures',async()=>{
    const db=await fixture(true);
    try {
      await db.exec(read('tests/db/analytics-observed-rate-full-chain.sql'));
      const users=await db.query<{count:number}>('SELECT count(*)::int AS count FROM auth.users');
      const sessions=await db.query<{count:number}>('SELECT count(*)::int AS count FROM public.sessions');
      expect(users.rows[0].count).toBe(0);expect(sessions.rows[0].count).toBe(0);
    } finally {await db.close();}
  });
  it('fails the actual old rate function rather than declaring its denominator acceptable',async()=>{
    const db=await fixture(false);
    try {
      await expect(db.exec(read('tests/db/analytics-observed-rate-full-chain.sql')))
        .rejects.toThrow('observed filler rate denominator/contributor mismatch');
      await db.exec('ROLLBACK');
      expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM auth.users')).rows[0].count).toBe(0);
    } finally {await db.close();}
  });
});
