## Jawaban singkat
Tidak perlu langsung ganti project Supabase. Dari codebase terbaru, frontend sudah tidak memanggil Supabase langsung; semua data lewat `/api/*` di Vercel. Jadi masalah paling mungkin ada di konfigurasi environment variable Vercel, nama variable yang tidak cocok, atau API endpoint yang belum memberi pesan error yang cukup jelas.

## Rencana perbaikan
1. **Samakan konfigurasi environment**
   - Update `.env.example` agar sesuai dengan kode saat ini: `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` untuk server Vercel.
   - Tambahkan catatan bahwa `VITE_SUPABASE_*` tidak dipakai lagi oleh HTML publik.

2. **Rapikan Supabase client server-side**
   - Hilangkan pola duplikasi `getSupabase()` di beberapa API file.
   - Pakai helper bersama dari `api/_supabase.js` supaya semua endpoint membaca env dengan cara yang sama.
   - Pastikan pembacaan env terjadi saat request, bukan saat import module, agar lebih aman untuk deployment serverless.

3. **Tambahkan endpoint health check aman**
   - Buat/ubah endpoint API untuk mengecek koneksi tanpa membocorkan key, contoh response:
     - `envConfigured: true/false`
     - `canQuery: true/false`
     - pesan error Supabase yang sudah disanitasi
   - Ini membantu memastikan apakah error dari Vercel env, credential salah, tabel/RPC tidak ada, atau koneksi Supabase gagal.

4. **Perjelas error di frontend**
   - Ubah fetch helper di halaman publik agar kalau `/api/*` gagal, pesan yang muncul membedakan antara:
     - env server belum terpasang
     - API route tidak ditemukan
     - Supabase query/RPC/storage error
   - Tetap tidak menampilkan secret/key ke browser.

5. **Verifikasi non-invasif**
   - Cek ulang tidak ada hardcoded Supabase URL/key di file publik.
   - Validasi endpoint utama yang dipakai frontend: `/api/pendaftar`, `/api/donations`, `/api/merchandise`.

## Yang perlu Anda set di Vercel
Setelah implementasi, di Vercel Project Settings → Environment Variables gunakan:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

Tidak perlu mengganti project Supabase kecuali service role key lama memang sudah di-rotate/dihapus atau project Supabase-nya sudah rusak. Jika sebelumnya Anda menghapus key di dashboard Supabase, cukup buat/ambil key baru lalu pasang ulang di Vercel dan redeploy.