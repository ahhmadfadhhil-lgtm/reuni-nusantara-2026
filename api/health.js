// ============================================================
// /api/health.js — safe server-side diagnostics for Vercel.
// Does not expose Supabase URL, anon key, or service_role key.
// ============================================================
import { formatApiError, getSupabase, getSupabaseEnvStatus } from './_supabase.js';

function send(res, data, status = 200) {
  res.status(status).json(data);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return send(res, { ok: false, error: 'Method not allowed' }, 405);

  const env = getSupabaseEnvStatus();
  if (!env.configured) {
    return send(res, {
      ok: false,
      envConfigured: false,
      hasUrl: env.hasUrl,
      hasServiceRoleKey: env.hasServiceRoleKey,
      canQuery: false,
      error: formatApiError('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing'),
    });
  }

  try {
    const sb = getSupabase();
    const { error, count } = await sb
      .from('registrations')
      .select('registration_code', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      return send(res, {
        ok: false,
        envConfigured: true,
        hasUrl: true,
        hasServiceRoleKey: true,
        canQuery: false,
        error: formatApiError(error.message),
        code: error.code || null,
      });
    }

    return send(res, {
      ok: true,
      envConfigured: true,
      hasUrl: true,
      hasServiceRoleKey: true,
      canQuery: true,
      registrationsCount: typeof count === 'number' ? count : null,
    });
  } catch (error) {
    return send(res, {
      ok: false,
      envConfigured: true,
      hasUrl: true,
      hasServiceRoleKey: true,
      canQuery: false,
      error: formatApiError(error),
    });
  }
}