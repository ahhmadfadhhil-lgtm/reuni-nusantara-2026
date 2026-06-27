// api/_supabase.js
// Shared server-side Supabase admin client.
// Uses SERVICE_ROLE key — NEVER exposed to the browser.
import { createClient } from '@supabase/supabase-js';

let cachedClient = null;
let cachedUrl = '';
let cachedKey = '';

export function getSupabaseEnvStatus() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return {
    hasUrl: Boolean(url),
    hasServiceRoleKey: Boolean(key),
    configured: Boolean(url && key),
  };
}

export function getSupabase() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !key) {
    throw new Error('Konfigurasi server Vercel belum lengkap: isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY, lalu redeploy.');
  }

  if (!cachedClient || cachedUrl !== url || cachedKey !== key) {
    cachedUrl = url;
    cachedKey = key;
    cachedClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return cachedClient;
}

export function formatApiError(error) {
  const message = String(error?.message || error || 'Internal server error');

  if (/SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|env vars|environment/i.test(message)) {
    return 'Konfigurasi server Vercel belum lengkap: isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di Environment Variables, lalu redeploy.';
  }

  if (/Invalid API key|JWT|signature|not a valid/i.test(message)) {
    return 'Kredensial Supabase server tidak valid. Pastikan SUPABASE_SERVICE_ROLE_KEY adalah service_role key yang benar, bukan anon/publishable key.';
  }

  if (/permission denied|row-level security|violates row-level security/i.test(message)) {
    return 'Koneksi Supabase berhasil, tetapi akses tabel ditolak. Periksa GRANT/RLS policy pada tabel terkait.';
  }

  if (/Could not find|does not exist|schema cache|function .* not found/i.test(message)) {
    return 'Koneksi Supabase berhasil, tetapi tabel/kolom/RPC yang dipanggil belum ada atau belum tersinkron di schema cache.';
  }

  return message;
}

// ── CORS helper ────────────────────────────────────────────────────────────
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── JSON response helpers ──────────────────────────────────────────────────
export function ok(res, data)  { res.status(200).json(data); }
export function err(res, msg, status = 400) {
  res.status(status).json({ error: formatApiError(msg) });
}
