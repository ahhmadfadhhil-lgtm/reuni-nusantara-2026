// ============================================================
// /api/pendaftar.js — Vercel Serverless Function
// Server-side proxy untuk semua operasi terkait pendaftar.
// Kredensial Supabase HANYA ada di sisi server (env vars Vercel).
//
// Security features:
//   - Rate limiting 5 req/menit/IP pada endpoint lookup
//   - Validasi MIME + magic bytes + ukuran file pada upload_receipt
//   - Tidak ada SUPABASE_URL / ANON_KEY yang dikirim ke browser
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getClientIp } from './_lib/rate-limit.js';
import { validateFileBuffer } from './_lib/validate-file.js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not configured on server.');
  return createClient(url, key);
}

function json(res, data, status = 200) {
  res.status(status).json(data);
}

function errRes(res, message, status = 500) {
  res.status(status).json({ error: message });
}

export default async function handler(req, res) {
  // CORS — hanya izinkan origin yang sama (same-site fetch dari public/)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    const sb = getSupabase();

    // ── GET actions ────────────────────────────────────────────────────────
    if (req.method === 'GET') {

      // GET /api/pendaftar?action=leaderboard
      if (action === 'leaderboard') {
        const only_paid = req.query.only_paid === 'true';
        const { data, error } = await sb.rpc('get_angkatan_counts', { _only_paid: only_paid });
        if (error) return errRes(res, error.message);
        return json(res, data);
      }

      // GET /api/pendaftar?action=check_donor&email=xxx
      if (action === 'check_donor') {
        const email = (req.query.email || '').trim().toLowerCase();
        if (!email) return errRes(res, 'Email required', 400);

        let verified = false;
        let foundOrderId = '';

        try {
          const { data, error } = await sb.rpc('check_donor_verified', { _email: email });
          if (!error && data) verified = true;
        } catch (_) {}

        try {
          const { data: rows, error: selErr } = await sb
            .from('donations')
            .select('id, amount, payment_status, order_id, created_at')
            .ilike('donor_email', email)
            .order('created_at', { ascending: false })
            .limit(5);
          if (!selErr && Array.isArray(rows) && rows.length > 0) {
            if (rows.some(r => Number(r.amount) > 0)) verified = true;
            const withOrder = rows.find(r => r.order_id);
            if (withOrder) foundOrderId = String(withOrder.order_id);
          }
        } catch (_) {}

        return json(res, { verified, orderId: verified ? foundOrderId : '' });
      }

      // GET /api/pendaftar?action=get_ticket&code=xxx
      if (action === 'get_ticket') {
        const code = (req.query.code || '').trim().toUpperCase();
        if (!code) return errRes(res, 'code required', 400);
        const { data, error } = await sb.rpc('get_registration_by_code', { _registration_code: code });
        if (error) return errRes(res, error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return json(res, row || null);
      }

      // GET /api/pendaftar?action=get_pre_event_link&code=xxx
      if (action === 'get_pre_event_link') {
        const code = (req.query.code || '').trim().toUpperCase();
        if (!code) return errRes(res, 'code required', 400);
        const { data, error } = await sb.rpc('get_pre_event_link', { _code: code });
        if (error) return errRes(res, error.message);
        return json(res, { link: data || null });
      }

      // GET /api/pendaftar?action=verify_referral&angkatan=xxx&kode=xxx
      if (action === 'verify_referral') {
        const angkatan = (req.query.angkatan || '').trim();
        const kode = (req.query.kode || '').trim().toUpperCase();
        if (!angkatan || !kode) return errRes(res, 'angkatan and kode required', 400);

        let valid = false;
        const rpc = await sb.rpc('verify_referral', { _angkatan: angkatan, _kode: kode });
        if (!rpc.error) {
          valid = !!rpc.data;
        } else {
          const { data, error: selErr } = await sb
            .from('master_referral')
            .select('kode_referral')
            .eq('angkatan', angkatan)
            .ilike('kode_referral', kode)
            .limit(1);
          if (!selErr && Array.isArray(data) && data.length > 0) valid = true;
        }
        return json(res, { valid });
      }

      // GET /api/pendaftar?action=sektor_counts
      if (action === 'sektor_counts') {
        const { data, error } = await sb
          .from('registrations')
          .select('pre_event_sectors')
          .eq('pre_event', true);
        if (error) return errRes(res, error.message);
        return json(res, data || []);
      }

      // GET /api/pendaftar?action=check_email&email=xxx
      if (action === 'check_email') {
        const email = (req.query.email || '').trim().toLowerCase();
        if (!email) return errRes(res, 'email required', 400);
        const { data, error } = await sb
          .from('registrations')
          .select('registration_code, payment_status')
          .ilike('email', email)
          .limit(1);
        if (error) return errRes(res, error.message);
        if (!data || data.length === 0) return json(res, null);
        return json(res, data[0]);
      }

      return errRes(res, 'Unknown action', 400);
    }

    // ── POST actions ───────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = req.body || {};

      // POST /api/pendaftar?action=lookup
      // ⚡ RATE LIMITED: maks 5 permintaan / menit / IP
      if (action === 'lookup') {
        const ip = getClientIp(req);
        const rl = checkRateLimit(ip, 5, 60_000);

        if (!rl.allowed) {
          const retryAfter = Math.ceil(rl.resetInMs / 1000);
          res.setHeader('Retry-After', String(retryAfter));
          res.setHeader('X-RateLimit-Limit', '5');
          res.setHeader('X-RateLimit-Remaining', '0');
          return res.status(429).json({
            error: `Terlalu banyak percobaan. Coba lagi dalam ${retryAfter} detik.`,
            retryAfterSeconds: retryAfter,
          });
        }

        res.setHeader('X-RateLimit-Limit', '5');
        res.setHeader('X-RateLimit-Remaining', String(rl.remaining));

        const { identifier, kode } = body;
        if (!identifier || !kode) return errRes(res, 'identifier and kode required', 400);

        const { data, error } = await sb.rpc('lookup_registration', {
          _identifier: identifier,
          _kode: kode.trim().toUpperCase(),
        });
        if (error) return errRes(res, error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return json(res, row || null);
      }

      // POST /api/pendaftar?action=get_ticket_with_proof
      if (action === 'get_ticket_with_proof') {
        const { code } = body;
        if (!code) return errRes(res, 'code required', 400);
        const { data, error } = await sb.rpc('get_registration_by_code', { _registration_code: code });
        if (error) return errRes(res, error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return json(res, row || null);
      }

      // POST /api/pendaftar?action=insert
      if (action === 'insert') {
        const { payload } = body;
        if (!payload) return errRes(res, 'payload required', 400);
        const { error } = await sb.from('registrations').insert(payload);
        if (error) return errRes(res, error.message);
        return json(res, { success: true });
      }

      // POST /api/pendaftar?action=attach_proof
      if (action === 'attach_proof') {
        const { registration_code, kode_referensi, proof_url } = body;
        if (!registration_code || !kode_referensi || !proof_url)
          return errRes(res, 'registration_code, kode_referensi, proof_url required', 400);
        const { data, error } = await sb.rpc('attach_payment_proof', {
          _registration_code: registration_code,
          _kode_referensi: kode_referensi,
          _proof_url: proof_url,
        });
        if (error) return errRes(res, error.message);
        return json(res, { success: true, data });
      }

      // POST /api/pendaftar?action=upload_receipt
      // 🔒 VALIDASI SERVER: MIME type, magic bytes, ukuran file
      if (action === 'upload_receipt') {
        const { fileBase64, contentType, path: storagePath } = body;
        if (!fileBase64 || !contentType || !storagePath)
          return errRes(res, 'fileBase64, contentType, path required', 400);

        // Decode dulu untuk validasi
        let buffer;
        try {
          buffer = Buffer.from(fileBase64, 'base64');
        } catch {
          return errRes(res, 'Format base64 tidak valid.', 400);
        }

        // Validasi MIME + magic bytes + ukuran
        const validation = validateFileBuffer(buffer, contentType);
        if (!validation.ok) {
          return errRes(res, validation.error, 400);
        }

        // Sanitise path — cegah path traversal
        const safePath = storagePath.replace(/\.\.[\/\\]/g, '').replace(/^[\/\\]+/, '');
        if (!safePath) return errRes(res, 'Path tidak valid.', 400);

        const { error: upErr } = await sb.storage
          .from('receipts')
          .upload(safePath, buffer, { contentType, upsert: false });
        if (upErr) return errRes(res, upErr.message);

        const { data: pub } = sb.storage.from('receipts').getPublicUrl(safePath);
        return json(res, { publicUrl: pub?.publicUrl || null });
      }

      return errRes(res, 'Unknown action', 400);
    }

    return errRes(res, 'Method not allowed', 405);
  } catch (e) {
    console.error('[api/pendaftar] error:', e);
    return errRes(res, e.message || 'Internal server error');
  }
}
