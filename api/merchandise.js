// ============================================================
// /api/merchandise.js — Vercel Serverless Function
// Server-side proxy untuk semua operasi merchandise order.
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

    if (req.method === 'GET') {
      // GET /api/merchandise?action=validate_ticket&code=xxx
      if (action === 'validate_ticket') {
        const code = (req.query.code || '').trim().toUpperCase();
        if (!code) return err(res, 'code required', 400);
        const { data, error } = await sb.rpc('get_registration_by_code', { _registration_code: code });
        if (error) return err(res, error.message);
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return json(res, null);
        // Hanya kembalikan field aman yang dibutuhkan frontend
        return json(res, {
          registration_code: row.registration_code,
          full_name: row.full_name,
          email: row.email,
          payment_status: row.payment_status,
        });
      }

      return err(res, 'Unknown action', 400);
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      // POST /api/merchandise?action=upload_receipt
      // Body: { fileBase64, contentType, path }
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

      // POST /api/merchandise?action=insert_order
      // Body: { registration_code, full_name, email, items, total_amount, payment_proof_url }
      if (action === 'insert_order') {
        const { registration_code, full_name, email, items, total_amount, payment_proof_url } = body;
        if (!registration_code || !items || !total_amount)
          return err(res, 'registration_code, items, total_amount required', 400);
        const { error: insErr } = await sb.from('merchandise_orders').insert({
          registration_code,
          full_name: full_name || '',
          email: email || '',
          items,
          total_amount: Number(total_amount),
          payment_proof_url: payment_proof_url || null,
          payment_status: 'pending',
        });
        if (insErr) return err(res, insErr.message);
        return json(res, { success: true });
      }

      return err(res, 'Unknown action', 400);
    }

    return err(res, 'Method not allowed', 405);
  } catch (e) {
    console.error('[api/merchandise] error:', e);
    return err(res, e.message || 'Internal server error');
  }
}
