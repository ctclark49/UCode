import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Singleton client for client-side (browser)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Singleton admin client for server-side (cached)
let adminClientInstance = null;

export const supabaseAdmin = () => {
  if (!supabaseServiceKey) {
    throw new Error('Missing Supabase service role key');
  }

  // Return cached instance if it exists
  if (adminClientInstance) {
    return adminClientInstance;
  }

  // Create and cache new instance
  adminClientInstance = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return adminClientInstance;
};

export const getSupabaseAdmin = () => {
  if (typeof window !== 'undefined') {
    throw new Error('Admin client can only be used server-side');
  }
  return supabaseAdmin();
};