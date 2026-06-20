import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Public Supabase project credentials. The anon key is designed to be shipped
// in client-side code; your data is protected by Row Level Security in the
// database (see supabase-schema.sql). Replace the two placeholders with the
// values from your project's Settings → API.
export const SUPABASE_URL = 'https://avvcykyxzymzcoibsifq.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2dmN5a3l4enltemNvaWJzaWZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5Mzc5MzEsImV4cCI6MjA5NzUxMzkzMX0.gQa6FTDO8t4zJKTvaGkWgouWxQveYXBANar-dd7odtc';

export const supabaseConfigured =
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
