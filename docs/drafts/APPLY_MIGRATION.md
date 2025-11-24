# Apply Pending Migrations to Production

To apply the pending migrations (including the new `custom_vocabulary` table) to the production Supabase database, run the following commands in your terminal:

```bash
# 1. Login to Supabase CLI (if not already logged in)
supabase login

# 2. Link your local project to the production project
# Replace <your-project-ref> with your actual Supabase project ID (found in Project Settings > General)
supabase link --project-ref <your-project-ref>

# 3. Push the pending migrations to the remote database
supabase db push
```

## Verification
After running the commands, you can verify the migration was successful by checking for the existence of the `custom_vocabulary` table in the Supabase Dashboard or by running:

```bash
# Verify table exists (requires psql or SQL editor)
supabase db reset --linked # WARNING: This resets remote if not careful. Safer to use dashboard.
```

**Safer Verification:**
Go to the [Supabase Dashboard](https://supabase.com/dashboard), select your project, go to the **Table Editor**, and confirm `custom_vocabulary` exists.
