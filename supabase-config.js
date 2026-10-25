/*
 * MỘC CAFÉ — Supabase client configuration.
 * Settings > API Keys: use only the publishable key (sb_publishable_...) or legacy anon key.
 * NEVER put service_role / secret key here; this file is public in the browser.
 */
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'YOUR_SUPABASE_PUBLISHABLE_KEY';

window.CAFE_CONFIGURED =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL) &&
  !SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
  SUPABASE_PUBLISHABLE_KEY.length > 15 &&
  !SUPABASE_PUBLISHABLE_KEY.includes('YOUR_') &&
  Boolean(window.supabase?.createClient);

window.cafeSupabase = window.CAFE_CONFIGURED
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;
