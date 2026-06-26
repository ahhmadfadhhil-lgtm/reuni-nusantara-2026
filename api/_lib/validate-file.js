// ============================================================
// api/_lib/validate-file.js
// Validasi file buffer di server: MIME type + magic bytes + ukuran.
// Hanya JPEG, PNG, dan WebP yang diizinkan.
// TIDAK ADA akses ke file system — semua validasi in-memory.
// ============================================================

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Magic bytes signatures untuk setiap format gambar
const MAGIC_BYTES = {
  'image/jpeg': [
    // JPEG: FF D8 FF
    [0xFF, 0xD8, 0xFF],
  ],
  'image/png': [
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  ],
  'image/webp': [
    // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
    // (RIFF....WEBP) — cek byte 0-3 = RIFF dan byte 8-11 = WEBP
    null, // special case handled below
  ],
};

/**
 * Validasi magic bytes WebP
 * Format: RIFF (4 bytes) + size (4 bytes) + WEBP (4 bytes)
 */
function isWebP(buffer) {
  if (buffer.length < 12) return false;
  const riff = buffer.slice(0, 4).toString('ascii');
  const webp = buffer.slice(8, 12).toString('ascii');
  return riff === 'RIFF' && webp === 'WEBP';
}

/**
 * Cek apakah buffer dimulai dengan sequence magic bytes yang diberikan
 */
function matchesMagic(buffer, magic) {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, i) => buffer[i] === byte);
}

/**
 * Validasi file buffer.
 * @param {Buffer} buffer - Buffer file yang sudah di-decode dari base64
 * @param {string} contentType - MIME type yang diklaim oleh client
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateFileBuffer(buffer, contentType) {
  // 1. Cek ukuran
  if (!buffer || buffer.length === 0) {
    return { ok: false, error: 'File kosong atau tidak dapat dibaca.' };
  }

  if (buffer.byteLength > MAX_FILE_SIZE) {
    return { ok: false, error: 'Ukuran file melebihi batas maksimal 5MB.' };
  }

  // 2. Normalisasi MIME type
  const ct = String(contentType || '').toLowerCase().trim();
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  if (!allowedTypes.includes(ct)) {
    return {
      ok: false,
      error: `Tipe file "${ct}" tidak diizinkan. Hanya JPEG, PNG, dan WebP yang diterima.`,
    };
  }

  // 3. Validasi magic bytes (header file asli)
  let magicOk = false;

  if (ct === 'image/jpeg') {
    magicOk = MAGIC_BYTES['image/jpeg'].some(magic => matchesMagic(buffer, magic));
    if (!magicOk) {
      return {
        ok: false,
        error: 'File bukan gambar JPEG yang valid. Kemungkinan file telah dimodifikasi atau bukan gambar asli.',
      };
    }
  } else if (ct === 'image/png') {
    magicOk = MAGIC_BYTES['image/png'].some(magic => matchesMagic(buffer, magic));
    if (!magicOk) {
      return {
        ok: false,
        error: 'File bukan gambar PNG yang valid. Kemungkinan file telah dimodifikasi atau bukan gambar asli.',
      };
    }
  } else if (ct === 'image/webp') {
    magicOk = isWebP(buffer);
    if (!magicOk) {
      return {
        ok: false,
        error: 'File bukan gambar WebP yang valid. Kemungkinan file telah dimodifikasi atau bukan gambar asli.',
      };
    }
  }

  return { ok: true };
}
