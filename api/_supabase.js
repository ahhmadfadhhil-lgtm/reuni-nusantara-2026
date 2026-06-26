// api/_supabase.js
// Shared server-side Supabase admin client.
// Uses SERVICE_ROLE key — NEVER exposed to the browser.
import { createClient } from '@supabase/supabase-js';

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('[api/_supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.');
}

// Single shared instance (Node module cache keeps this alive across requests)
export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── CORS helper ────────────────────────────────────────────────────────────
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── JSON response helpers ──────────────────────────────────────────────────
export function ok(res, data)  { res.status(200).json(data); }
export function err(res, msg, status = 400) {
  res.status(status).json({ error: String(msg) });
}
