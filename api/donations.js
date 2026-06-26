// ============================================================
// /api/donations.js — Vercel Serverless Function
// Server-side proxy untuk semua operasi donasi.
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

    if (req.method === 'POST') {
      const body = req.body || {};

      // POST /api/donations?action=insert
      // Body: { donor_name, donor_email, angkatan, amount, tshirt_size, order_id, payment_status }
      if (action === 'insert') {
        const { donor_name, donor_email, angkatan, amount, tshirt_size, order_id, payment_status } = body;
        if (!donor_name || !donor_email || !order_id)
          return err(res, 'donor_name, donor_email, order_id required', 400);

        const { error: insErr } = await sb.from('donations').insert({
          donor_name,
          donor_email,
          angkatan,
          amount: Number(amount),
          tshirt_size: tshirt_size || null,
          order_id,
          payment_status: payment_status || 'pending',
        });
        if (insErr) return err(res, insErr.message);
        return json(res, { success: true });
      }

      // POST /api/donations?action=attach_proof
      // Body: { order_id, proof_url }
      if (action === 'attach_proof') {
        const { order_id, proof_url } = body;
        if (!order_id || !proof_url) return err(res, 'order_id and proof_url required', 400);
        const { error: updErr } = await sb
          .from('donations')
          .update({ payment_proof_url: proof_url })
          .eq('order_id', order_id);
        if (updErr) return err(res, updErr.message);
        return json(res, { success: true });
      }

      // POST /api/donations?action=upload_receipt
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

      return err(res, 'Unknown action', 400);
    }

    return err(res, 'Method not allowed', 405);
  } catch (e) {
    console.error('[api/donations] error:', e);
    return err(res, e.message || 'Internal server error');
  }
}
