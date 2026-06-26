// ============================================================
// api/_lib/rate-limit.js
// In-memory sliding-window rate limiter.
// Vercel Serverless Functions berjalan di isolate per-region;
// limiter ini cukup kuat untuk anti brute-force ringan.
// Untuk produksi besar, ganti dengan Redis (Upstash, dll).
// ============================================================

/** @type {Map<string, number[]>} */
const store = new Map();

/**
 * Cek apakah IP sudah melebihi batas.
 *
 * @param {string}  ip          - Alamat IP klien
 * @param {number}  maxRequests - Maks request yang diizinkan dalam window
 * @param {number}  windowMs    - Durasi window dalam milidetik
 * @returns {{ allowed: boolean, remaining: number, resetInMs: number }}
 */
export function checkRateLimit(ip, maxRequests = 5, windowMs = 60_000) {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Ambil atau inisialisasi daftar timestamp untuk IP ini
  let timestamps = store.get(ip) || [];

  // Buang timestamp di luar window
  timestamps = timestamps.filter(t => t > windowStart);

  if (timestamps.length >= maxRequests) {
    // Hitung berapa ms lagi window pertama berakhir
    const oldestInWindow = timestamps[0];
    const resetInMs = oldestInWindow + windowMs - now;
    store.set(ip, timestamps);
    return { allowed: false, remaining: 0, resetInMs };
  }

  // Catat request baru
  timestamps.push(now);
  store.set(ip, timestamps);

  // Bersihkan entry lama agar memory tidak membengkak
  // (hanya dilakukan sesekali, bukan setiap request)
  if (Math.random() < 0.05) {
    for (const [key, ts] of store.entries()) {
      const cleaned = ts.filter(t => t > windowStart);
      if (cleaned.length === 0) store.delete(key);
      else store.set(key, cleaned);
    }
  }

  return {
    allowed: true,
    remaining: maxRequests - timestamps.length,
    resetInMs: 0,
  };
}

/**
 * Ekstrak IP klien dari request Vercel/Node.
 * Vercel meneruskan IP asli di header x-forwarded-for.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Bisa berupa "ip1, ip2, ip3" — ambil yang paling kiri (klien asli)
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}
