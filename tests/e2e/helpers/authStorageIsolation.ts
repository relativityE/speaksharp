/**
 * Clear stale Supabase auth exactly once per tab before the first application
 * boot. sessionStorage survives same-tab hard navigation, unlike a window
 * property, so auth seeded after isolation remains available to later routes.
 */
export function isolateAuthStorageOncePerTab(): void {
  const marker = '__SS_E2E_AUTH_STORAGE_ISOLATED_ONCE__';
  if (sessionStorage.getItem(marker) === 'true') return;

  Object.keys(localStorage)
    .filter(key => key.startsWith('sb-'))
    .forEach(key => localStorage.removeItem(key));

  sessionStorage.setItem(marker, 'true');
}

