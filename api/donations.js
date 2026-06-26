// ============================================================
// /api/donations.js — Vercel Serverless Function
// Server-side proxy untuk semua operasi donasi.
// Kredensial Supabase HANYA ada di sisi server (env vars Vercel).
//
// Security features:
//   - Validasi MIME header + magic bytes + ukuran file pada upload_receipt
//   - Hanya image/jpeg, image/png, image/webp yang diizinkan
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { validateFileBuffer } from './_lib/validate-file.js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not configured on server.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(res, data, status = 200) {
  res.status(status).json(data);
}

function errRes(res, message, status = 500) {
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
      if (action === 'insert') {
        const { donor_name, donor_email, angkatan, amount, tshirt_size, order_id, payment_status } = body;
        if (!donor_name || !donor_email || !order_id)
          return errRes(res, 'donor_name, donor_email, order_id required', 400);

        const amountNum = Number(amount);
        if (isNaN(amountNum) || amountNum < 10000)
          return errRes(res, 'Nominal minimum Rp 10.000.', 400);

        const { error: insErr } = await sb.from('donations').insert({
          donor_name: String(donor_name).trim(),
          donor_email: String(donor_email).trim().toLowerCase(),
          angkatan: angkatan || null,
          amount: amountNum,
          tshirt_size: tshirt_size || null,
          order_id: String(order_id).trim(),
          payment_status: payment_status || 'pending',
        });
        if (insErr) return errRes(res, insErr.message);
        return json(res, { success: true });
      }

      // POST /api/donations?action=attach_proof
      if (action === 'attach_proof') {
        const { order_id, proof_url } = body;
        if (!order_id || !proof_url) return errRes(res, 'order_id and proof_url required', 400);
        const { error: updErr } = await sb
          .from('donations')
          .update({ payment_proof_url: proof_url })
          .eq('order_id', order_id);
        if (updErr) return errRes(res, updErr.message);
        return json(res, { success: true });
      }

      // POST /api/donations?action=upload_receipt
      // 🔒 VALIDASI GANDA SERVER:
      //    1. Cek MIME type header — hanya image/jpeg, image/png, image/webp
      //    2. Cek ukuran file — maksimal 5MB
      //    3. Cek magic bytes nyata dari buffer — anti penyusupan malware
      if (action === 'upload_receipt') {
        const { fileBase64, contentType, path: storagePath } = body;
        if (!fileBase64 || !contentType || !storagePath)
          return errRes(res, 'fileBase64, contentType, path required', 400);

        // Validasi 1: MIME type header
        const ctLower = String(contentType).toLowerCase();
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedMimes.includes(ctLower)) {
          return errRes(
            res,
            'Hanya file gambar yang diizinkan (JPEG, PNG, atau WebP). File lain akan ditolak demi keamanan sistem.',
            400
          );
        }

        // Decode base64
        let buffer;
        try {
          buffer = Buffer.from(fileBase64, 'base64');
        } catch {
          return errRes(res, 'Format base64 tidak valid.', 400);
        }

        // Validasi 2: Ukuran file maksimal 5MB
        if (buffer.byteLength > 5 * 1024 * 1024) {
          return errRes(res, 'Ukuran file melebihi batas maksimal 5MB.', 400);
        }

        // Validasi 3: Magic bytes (cek header nyata file, bukan hanya MIME claim)
        const validation = validateFileBuffer(buffer, contentType);
        if (!validation.ok) {
          return errRes(res, validation.error, 400);
        }

        // Sanitise path — cegah path traversal attack
        const safePath = storagePath.replace(/\.\.[\/\\]/g, '').replace(/^[\/\\]+/, '');
        if (!safePath) return errRes(res, 'Path tidak valid.', 400);

        const { error: upErr } = await sb.storage
          .from('receipts')
          .upload(safePath, buffer, { contentType: ctLower, upsert: false });
        if (upErr) return errRes(res, upErr.message);

        const { data: pub } = sb.storage.from('receipts').getPublicUrl(safePath);
        return json(res, { publicUrl: pub?.publicUrl || null });
      }

      return errRes(res, 'Unknown action', 400);
    }

    return errRes(res, 'Method not allowed', 405);
  } catch (e) {
    console.error('[api/donations] error:', e);
    return errRes(res, e.message || 'Internal server error');
  }
}
