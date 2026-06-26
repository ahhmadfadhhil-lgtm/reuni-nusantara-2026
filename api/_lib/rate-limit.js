// ============================================================
// api/_lib/rate-limit.js
// In-memory rate limiter sederhana untuk Vercel Serverless Functions.
// Maks N request per window waktu per IP.
//
// Catatan: Karena Vercel Functions bisa berjalan di instance berbeda,
// rate limit ini berlaku per-instance. Untuk produksi skala besar,
// gunakan Redis (Upstash KV). Untuk kasus ini sudah cukup.
// ============================================================

/** @type {Map<string, { count: number, resetAt: number }>} */
const store = new Map();

// Bersihkan entry lama setiap 5 menit
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store.entries()) {
    if (now > val.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

/**
 * Cek dan catat request untuk IP tertentu.
 * @param {string} ip - Alamat IP client
 * @param {number} limit - Maksimum request dalam window waktu
 * @param {number} windowMs - Durasi window waktu dalam ms (default 60000 = 1 menit)
 * @returns {{ allowed: boolean, remaining: number, resetInMs: number }}
 */
export function checkRateLimit(ip, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const key = `rl:${ip}`;

  let entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  entry.count += 1;
  store.set(key, entry);

  const allowed = entry.count <= limit;
  const remaining = Math.max(0, limit - entry.count);
  const resetInMs = Math.max(0, entry.resetAt - now);

  return { allowed, remaining, resetInMs };
}

/**
 * Ambil IP asli client dari request headers.
 * Mendukung Vercel, Cloudflare, dan proxy standar.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function getClientIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['cf-connecting-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
