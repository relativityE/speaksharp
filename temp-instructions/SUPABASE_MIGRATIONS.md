# Supabase Migration Guide

## Overview
This project uses Supabase migrations to manage database schema changes. All migrations are version-controlled in `supabase/migrations/`.

## Local Development

### Applying Migrations Locally
Migrations are automatically applied when running the development server with a local Supabase instance.

If you need to manually apply migrations:
```bash
supabase db reset  # Reset local DB and apply all migrations
# OR
supabase migration up  # Apply pending migrations only
```

## Production Deployment

### Applying Migrations to Production

1. **Via Supabase Dashboard** (Recommended for initial deployment):
   - Go to [Supabase Dashboard](https://app.supabase.com/)
   - Navigate to your project → **Database** → **Migrations**
   - Copy the SQL from your migration file (e.g., `20251120004400_custom_vocabulary.sql`)
   - Paste into the **SQL Editor** and run

2. **Via Supabase CLI** (For automated deployments):
   ```bash
   # Link to your production project
   supabase link --project-ref <your-project-ref>
   
   # Push migrations to production
   supabase db push
   ```

3. **Via GitHub Actions** (Future automation):
   - Can be configured to auto-apply migrations on merge to main
   - Requires `SUPABASE_ACCESS_TOKEN` secret

### Verification

After applying a migration, verify it worked:

```sql
-- Check if table exists
SELECT * FROM custom_vocabulary LIMIT 1;

-- Verify RLS policies
SELECT * FROM pg_policies WHERE tablename = 'custom_vocabulary';
```

## Migration Workflow

### Creating a New Migration

1. Create file: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
2. Write SQL (DDL only - CREATE, ALTER, DROP)
3. Test locally with `supabase db reset`
4. Commit to git
5. Apply to production after merge

### Migration Best Practices

- **Atomic**: Each migration should be a single, focused change
- **Idempotent**: Use `IF NOT EXISTS` where possible
- **Reversible**: Consider including a rollback script in comments
- **Tested**: Always test locally before production

## Current Migrations

- `20251120004400_custom_vocabulary.sql` - **PENDING PRODUCTION** - Adds `custom_vocabulary` table for user-defined custom words

## Troubleshooting

### Migration Failed
- Check SQL syntax
- Verify no conflicting table/index names
- Check RLS permissions

### Reset Local Database
```bash
supabase db reset  # Warning: Destroys all local data
```
