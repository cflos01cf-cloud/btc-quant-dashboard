import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the service_role key.
 * Only used in Netlify Functions and Next.js API routes (server-side).
 * Never exposed to the browser.
 *
 * Environment variables set in Netlify:
 *   SUPABASE_URL          → https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  → service_role key (eyJ...)
 */
export function getSupabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan variables de entorno: SUPABASE_URL y/o SUPABASE_SERVICE_KEY"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
