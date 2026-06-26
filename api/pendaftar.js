// ============================================================
// /api/pendaftar.js — Vercel Serverless Function
// Server-side proxy untuk semua operasi terkait pendaftar.
// Kredensial Supabase HANYA ada di sisi server (env vars Vercel).
// ============================================================
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not configured on server.');
  return createClient(url, key);
}

function json(res, data, status = 200) {
  res.status(status).json(data);
}

function err(res, message, status = 500) {
  res.status(status).json({ error: message });
}

export default async function handler(req, res) {
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
        if (error) return err(res, error.message);
        return json(res, data);
      }

      // GET /api/pendaftar?action=check_donor&email=xxx
      if (action === 'check_donor') {
        const email = (req.query.email || '').trim().toLowerCase();
        if (!email) return err(res, 'Email required', 400);

        let verified = false;
        let foundOrderId = '';

        // RPC check
        try {
          const { data, error } = await sb.rpc('check_donor_verified', { _email: email });
          if (!error && data) verified = true;
        } catch (_) {}

        // Fallback table check
        try {
          const { data: rows, error: selErr } = await sb
            .from('donations')
            .select('id, amount, payment_status, order_id, created_at')
            .ilike('donor_email', email)
            .order('created_at', { ascending: false })
            .limit(5);
          if (!selErr && Array.isArray(rows) && rows.length > 0) {
            const hasAny = rows.some(r => Number(r.amount) > 0);
            if (hasAny) verified = true;
            const withOrder = rows.find(r => r.order_id);
            if (withOrder) foundOrderId = String(withOrder.order_id);
          }
        } catch (_) {}

        return json(res, { verified, orderId: verified ? foundOrderId : '' });
      }

      // GET /api/pendaftar?action=get_ticket&code=xxx
      if (action === 'get_ticket') {
        const code = (req.query.code || '').trim().toUpperCase();
        if (!code) return err(res, 'code required', 400);
        const { data, error } = await sb.rpc('get_registration_by_code', { _registration_code: code });
        if (error) return err(res, error.message);
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return json(res, null);
        return json(res, row);
      }

      // GET /api/pendaftar?action=get_pre_event_link&code=xxx
      if (action === 'get_pre_event_link') {
        const code = (req.query.code || '').trim().toUpperCase();
        if (!code) return err(res, 'code required', 400);
        const { data, error } = await sb.rpc('get_pre_event_link', { _code: code });
        if (error) return err(res, error.message);
        return json(res, { link: data || null });
      }

      // GET /api/pendaftar?action=verify_referral&angkatan=xxx&kode=xxx
      if (action === 'verify_referral') {
        const angkatan = (req.query.angkatan || '').trim();
        const kode = (req.query.kode || '').trim().toUpperCase();
        if (!angkatan || !kode) return err(res, 'angkatan and kode required', 400);

        let valid = false;
        const rpc = await sb.rpc('verify_referral', { _angkatan: angkatan, _kode: kode });
        if (!rpc.error) {
          valid = !!rpc.data;
        } else {
          // Fallback direct lookup
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
        if (error) return err(res, error.message);
        return json(res, data || []);
      }

      // GET /api/pendaftar?action=check_email&email=xxx
      if (action === 'check_email') {
        const email = (req.query.email || '').trim().toLowerCase();
        if (!email) return err(res, 'email required', 400);
        const { data, error } = await sb
          .from('registrations')
          .select('registration_code, payment_status')
          .ilike('email', email)
          .limit(1);
        if (error) return err(res, error.message);
        if (!data || data.length === 0) return json(res, null);
        return json(res, data[0]);
      }

      return err(res, 'Unknown action', 400);
    }

    // ── POST actions ───────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = req.body || {};

      // POST /api/pendaftar?action=lookup
      if (action === 'lookup') {
        const { identifier, kode } = body;
        if (!identifier || !kode) return err(res, 'identifier and kode required', 400);
        const { data, error } = await sb.rpc('lookup_registration', {
          _identifier: identifier,
          _kode: kode.trim().toUpperCase(),
        });
        if (error) return err(res, error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return json(res, row || null);
      }

      // POST /api/pendaftar?action=get_ticket_with_proof
      if (action === 'get_ticket_with_proof') {
        const { code } = body;
        if (!code) return err(res, 'code required', 400);
        const { data, error } = await sb.rpc('get_registration_by_code', { _registration_code: code });
        if (error) return err(res, error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return json(res, row || null);
      }

      // POST /api/pendaftar?action=insert
      if (action === 'insert') {
        const { payload } = body;
        if (!payload) return err(res, 'payload required', 400);
        const { error } = await sb.from('registrations').insert(payload);
        if (error) return err(res, error.message);
        return json(res, { success: true });
      }

      // POST /api/pendaftar?action=attach_proof
      if (action === 'attach_proof') {
        const { registration_code, kode_referensi, proof_url } = body;
        if (!registration_code || !kode_referensi || !proof_url)
          return err(res, 'registration_code, kode_referensi, proof_url required', 400);
        const { data, error } = await sb.rpc('attach_payment_proof', {
          _registration_code: registration_code,
          _kode_referensi: kode_referensi,
          _proof_url: proof_url,
        });
        if (error) return err(res, error.message);
        return json(res, { success: true, data });
      }

      // POST /api/pendaftar?action=upload_receipt
      // Menerima multipart/form-data: field "file" (base64) + field "path"
      if (action === 'upload_receipt') {
        const { fileBase64, contentType, path: storagePath } = body;
        if (!fileBase64 || !contentType || !storagePath)
          return err(res, 'fileBase64, contentType, path required', 400);
        const buffer = Buffer.from(fileBase64, 'base64');
        const { error: upErr } = await sb.storage
          .from('receipts')
          .upload(storagePath, buffer, { contentType, upsert: false });
        if (upErr) return err(res, upErr.message);
        const { data: pub } = sb.storage.from('receipts').getPublicUrl(storagePath);
        return json(res, { publicUrl: pub?.publicUrl || null });
      }

      return err(res, 'Unknown action', 400);
    }

    return err(res, 'Method not allowed', 405);
  } catch (e) {
    console.error('[api/pendaftar] error:', e);
    return err(res, e.message || 'Internal server error');
  }
}
