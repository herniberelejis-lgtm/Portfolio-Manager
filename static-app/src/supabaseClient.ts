import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Public Supabase project credentials. The anon key is designed to be shipped
// in client-side code; your data is protected by Row Level Security in the
// database (see supabase-schema.sql). Replace the two placeholders with the
// values from your project's Settings → API.
export const SUPABASE_URL = '__SUPABASE_URL__';
export const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';

export const supabaseConfigured =
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
