// ============================================================
// api/_lib/validate-file.js
// Validasi file upload di sisi server sebelum diteruskan ke
// Supabase Storage.
// Mencegah upload file berbahaya / non-gambar.
// ============================================================

/** MIME types yang diizinkan untuk bukti pembayaran */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Ukuran maksimum file: 5 MB */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Magic bytes (file signature) untuk tipe gambar umum.
 * Digunakan untuk memverifikasi konten file, bukan hanya MIME header
 * yang bisa dipalsukan oleh klien.
 */
const MAGIC_SIGNATURES = [
  // JPEG: FF D8 FF
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4e, 0x47] },
  // GIF: 47 49 46 38
  { mime: 'image/gif',  bytes: [0x47, 0x49, 0x46, 0x38] },
  // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
];

/**
 * Validasi buffer file yang diupload.
 *
 * @param {Buffer} buffer       - Isi file sebagai Buffer
 * @param {string} contentType  - MIME type yang diklaim klien
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateFileBuffer(buffer, contentType) {
  // 1. Normalise MIME
  const mime = (contentType || '').toLowerCase().split(';')[0].trim();

  // 2. Cek MIME type yang diizinkan
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return {
      ok: false,
      error: `Tipe file tidak diizinkan: ${mime}. Hanya JPEG, PNG, WebP, atau GIF.`,
    };
  }

  // 3. Cek ukuran file
  if (!buffer || buffer.length === 0) {
    return { ok: false, error: 'File kosong.' };
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (buffer.length / 1024 / 1024).toFixed(2);
    return {
      ok: false,
      error: `Ukuran file terlalu besar: ${sizeMb} MB. Maksimum 5 MB.`,
    };
  }

  // 4. Verifikasi magic bytes (cek header file sungguhan)
  const header = buffer.subarray(0, 12);
  let signatureMatched = false;

  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset || 0;
    const matches = sig.bytes.every((b, i) => header[offset + i] === b);
    if (matches) {
      signatureMatched = true;
      break;
    }
  }

  if (!signatureMatched) {
    return {
      ok: false,
      error: 'Konten file tidak sesuai dengan tipe gambar yang valid.',
    };
  }

  return { ok: true };
}
