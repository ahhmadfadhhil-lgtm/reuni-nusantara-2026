// ============================================================
// /api/merchandise.js — Vercel Serverless Function
// Server-side proxy untuk semua operasi merchandise order.
// Kredensial Supabase HANYA ada di sisi server (env vars Vercel).
//
// Security features:
//   - validate_ticket: WAJIB payment_status = 'success' (anti bypass)
//   - Validasi MIME + magic bytes + ukuran file pada upload_receipt
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

    if (req.method === 'GET') {

      // GET /api/merchandise?action=validate_ticket&code=xxx
      // 🔒 WAJIB payment_status === 'success' — alumni yang belum bayar ditolak
      if (action === 'validate_ticket') {
        const code = (req.query.code || '').trim().toUpperCase();
        if (!code) return errRes(res, 'code required', 400);

        let row = null;

        // Coba via RPC dulu
        try {
          const { data, error } = await sb.rpc('get_registration_by_code', { _registration_code: code });
          if (!error) {
            row = Array.isArray(data) ? data[0] : data;
          }
        } catch (_) {}

        // Fallback langsung ke tabel jika RPC tidak tersedia
        if (!row) {
          const { data: rows, error: selErr } = await sb
            .from('registrations')
            .select('registration_code, full_name, email, payment_status, angkatan_islah')
            .ilike('registration_code', code)
            .limit(1);
          if (selErr) return errRes(res, selErr.message);
          row = (rows && rows.length > 0) ? rows[0] : null;
        }

        // Tiket tidak ditemukan
        if (!row) {
          return json(res, null, 404);
        }

        // 🔒 CEK PAYMENT STATUS — hanya 'success' yang boleh order merchandise
        const payStatus = String(row.payment_status || '').toLowerCase();
        if (payStatus !== 'success') {
          return errRes(
            res,
            `Pembelian merchandise hanya untuk peserta yang sudah lunas. Status tiket Anda saat ini: ${row.payment_status || 'Pending'}. Selesaikan pembayaran terlebih dahulu.`,
            403
          );
        }

        return json(res, {
          registration_code: row.registration_code,
          full_name: row.full_name,
          email: row.email,
          payment_status: row.payment_status,
          angkatan_islah: row.angkatan_islah,
        });
      }

      // GET /api/merchandise?action=get_orders&code=xxx
      if (action === 'get_orders') {
        const code = (req.query.code || '').trim().toUpperCase();
        if (!code) return errRes(res, 'code required', 400);
        const { data, error } = await sb
          .from('merchandise_orders')
          .select('items, total_amount, payment_status, created_at')
          .eq('registration_code', code)
          .order('created_at', { ascending: false });
        if (error) return errRes(res, error.message);
        return json(res, data || []);
      }

      return errRes(res, 'Unknown action', 400);
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      // POST /api/merchandise?action=upload_receipt
      // 🔒 VALIDASI SERVER: MIME type, magic bytes, ukuran file
      if (action === 'upload_receipt') {
        const { fileBase64, contentType, path: storagePath } = body;
        if (!fileBase64 || !contentType || !storagePath)
          return errRes(res, 'fileBase64, contentType, path required', 400);

        // Validasi MIME type di level header — hanya izinkan image/*
        const ctLower = String(contentType).toLowerCase();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(ctLower)) {
          return errRes(res, 'Hanya file gambar yang diizinkan (JPEG, PNG, WebP).', 400);
        }

        let buffer;
        try {
          buffer = Buffer.from(fileBase64, 'base64');
        } catch {
          return errRes(res, 'Format base64 tidak valid.', 400);
        }

        // Cek ukuran file — maksimal 5MB
        if (buffer.byteLength > 5 * 1024 * 1024) {
          return errRes(res, 'Ukuran file melebihi batas maksimal 5MB.', 400);
        }

        // Validasi magic bytes + MIME via library
        const validation = validateFileBuffer(buffer, contentType);
        if (!validation.ok) {
          return errRes(res, validation.error, 400);
        }

        // Sanitise path — cegah path traversal
        const safePath = storagePath.replace(/\.\.[\/\\]/g, '').replace(/^[\/\\]+/, '');
        if (!safePath) return errRes(res, 'Path tidak valid.', 400);

        const { error: upErr } = await sb.storage
          .from('receipts')
          .upload(safePath, buffer, { contentType: ctLower, upsert: false });
        if (upErr) return errRes(res, upErr.message);

        const { data: pub } = sb.storage.from('receipts').getPublicUrl(safePath);
        return json(res, { publicUrl: pub?.publicUrl || null });
      }

      // POST /api/merchandise?action=insert_order
      if (action === 'insert_order') {
        const { registration_code, full_name, email, items, total_amount, payment_proof_url } = body;
        if (!registration_code || !items || !total_amount)
          return errRes(res, 'registration_code, items, total_amount required', 400);

        // Verifikasi ulang payment_status di server sebelum insert
        const { data: checkRows, error: checkErr } = await sb
          .from('registrations')
          .select('payment_status')
          .ilike('registration_code', registration_code)
          .limit(1);
        if (checkErr) return errRes(res, checkErr.message);
        const checkRow = checkRows && checkRows[0];
        if (!checkRow || String(checkRow.payment_status || '').toLowerCase() !== 'success') {
          return errRes(
            res,
            'Tidak dapat memproses pesanan: status pembayaran tiket belum sukses.',
            403
          );
        }

        const { error: insErr } = await sb.from('merchandise_orders').insert({
          registration_code,
          full_name: full_name || '',
          email: email || '',
          items,
          total_amount: Number(total_amount),
          payment_proof_url: payment_proof_url || null,
          payment_status: 'pending',
        });
        if (insErr) return errRes(res, insErr.message);
        return json(res, { success: true });
      }

      return errRes(res, 'Unknown action', 400);
    }

    return errRes(res, 'Method not allowed', 405);
  } catch (e) {
    console.error('[api/merchandise] error:', e);
    return errRes(res, e.message || 'Internal server error');
  }
}
