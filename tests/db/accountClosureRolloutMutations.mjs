// Shared catalog mutations for the existing in-process and native PG proofs.
// No connection, runner, provider action or production data belongs here.
const dropSignup = 'DROP TRIGGER on_auth_user_created_trial_profile ON auth.users;';
const signup = 'CREATE TRIGGER on_auth_user_created_trial_profile';
const call = 'EXECUTE FUNCTION public.ensure_trial_profile_for_new_user()';
const dropEmail = 'ALTER TABLE trial_entitlements DROP CONSTRAINT trial_entitlements_pkey;';
const dropOwner = 'ALTER TABLE trial_entitlements DROP CONSTRAINT trial_entitlements_user_id_fkey;';
export const closureRolloutDependencyMutations = [
    dropSignup,
    'ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created_trial_profile',
    'ALTER TABLE auth.users ENABLE REPLICA TRIGGER on_auth_user_created_trial_profile',
    'ALTER TABLE auth.users ENABLE ALWAYS TRIGGER on_auth_user_created_trial_profile',
    `${dropSignup} ${signup} AFTER INSERT ON user_profiles FOR EACH ROW ${call}`,
    `${dropSignup} CREATE FUNCTION wrong_signup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
      ${signup} AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION wrong_signup()`,
    `${dropSignup} ${signup} AFTER UPDATE ON auth.users FOR EACH ROW ${call}`,
    `${dropSignup} ${signup} BEFORE INSERT ON auth.users FOR EACH ROW ${call}`,
    `${dropSignup} ${signup} AFTER INSERT OR UPDATE ON auth.users FOR EACH ROW ${call}`,
    `${dropSignup} ${signup} AFTER INSERT ON auth.users FOR EACH STATEMENT ${call}`,
    `${dropSignup} ${signup} AFTER INSERT ON auth.users FOR EACH ROW WHEN(false) ${call}`,
    `${dropSignup} ${signup} AFTER INSERT ON auth.users FOR EACH ROW ${call.replace('()', "('unexpected')")}`,
    `${dropSignup} CREATE CONSTRAINT TRIGGER on_auth_user_created_trial_profile AFTER INSERT ON auth.users
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW ${call}`,
    `${dropSignup} ${signup} AFTER INSERT ON auth.users REFERENCING NEW TABLE AS new_users FOR EACH ROW ${call}`,
    dropEmail,
    `${dropEmail} ALTER TABLE trial_entitlements ADD UNIQUE(email,user_id)`,
    `${dropEmail} CREATE UNIQUE INDEX partial_email ON trial_entitlements(email) WHERE user_id IS NOT NULL`,
    `${dropEmail} CREATE UNIQUE INDEX expression_email ON trial_entitlements(lower(email))`,
    `${dropEmail} ALTER TABLE trial_entitlements ADD UNIQUE(email) DEFERRABLE`,
    'ALTER TABLE trial_entitlements ADD UNIQUE(email) DEFERRABLE',
    dropOwner,
    `${dropOwner} ALTER TABLE trial_entitlements ADD FOREIGN KEY(user_id) REFERENCES user_profiles(id) ON DELETE SET NULL`,
    `${dropOwner} ALTER TABLE auth.users ADD COLUMN alternate_id uuid UNIQUE;
      ALTER TABLE trial_entitlements ADD FOREIGN KEY(user_id) REFERENCES auth.users(alternate_id) ON DELETE SET NULL`,
    ...['CASCADE', 'RESTRICT', 'NO ACTION'].map((action) => `${dropOwner}
      ALTER TABLE trial_entitlements ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE ${action}`),
    `${dropOwner} ALTER TABLE trial_entitlements ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID`,
    `${dropOwner} ALTER TABLE auth.users ADD UNIQUE(id,email);
      ALTER TABLE trial_entitlements ADD FOREIGN KEY(user_id,email) REFERENCES auth.users(id,email) ON DELETE SET NULL`,
    'ALTER TABLE trial_entitlements ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
    'ALTER TABLE trial_entitlements ALTER COLUMN user_id SET NOT NULL',
];
