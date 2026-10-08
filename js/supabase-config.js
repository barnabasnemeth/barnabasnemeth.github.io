// Public browser credentials only. Do not add a secret or service_role key.
window.CREMES_SUPABASE_URL = 'https://ueveupqtkjzhedlnkpki.supabase.co';
window.CREMES_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__Siw4K9D-Hl5zAsdspOa2A_OyLO2i2y';

window.cremesSupabase = function () {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('A Supabase kliens nem töltődött be.');
  }
  if (!window.__cremesSupabaseClient) {
    window.__cremesSupabaseClient = window.supabase.createClient(
      window.CREMES_SUPABASE_URL,
      window.CREMES_SUPABASE_PUBLISHABLE_KEY
    );
  }
  return window.__cremesSupabaseClient;
};
