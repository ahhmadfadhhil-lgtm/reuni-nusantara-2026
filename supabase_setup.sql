-- =====================================================================
-- 1) VERIFIKASI: kolom payment_proof_url pada tabel donations
-- =====================================================================
-- Cek apakah kolom sudah ada
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'donations'
  AND column_name = 'payment_proof_url';
-- Jika kosong (0 baris), jalankan:
ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS payment_proof_url text;

-- =====================================================================
-- 2) VERIFIKASI: RLS policy untuk UPDATE bukti donasi oleh anon
-- =====================================================================
-- Cek RLS aktif
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'donations' AND relnamespace = 'public'::regnamespace;

-- Cek policy yang ada
SELECT polname, polcmd, polroles::regrole[]
FROM pg_policy
WHERE polrelid = 'public.donations'::regclass;

-- Jika belum ada policy UPDATE untuk anon (untuk attach bukti via order_id):
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon can attach proof by order_id" ON public.donations;
CREATE POLICY "anon can attach proof by order_id"
  ON public.donations FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
GRANT UPDATE (payment_proof_url) ON public.donations TO anon;

-- =====================================================================
-- 3) RPC RAHASIA: link grup WhatsApp pre-event
-- =====================================================================
-- Link disimpan SERVER-SIDE saja. Hanya peserta dengan
-- registration_code yang valid DAN pre_event = true yang menerima link.
CREATE OR REPLACE FUNCTION public.get_pre_event_link(_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_access boolean;
BEGIN
  -- Link HANYA diberikan jika:
  -- 1. Kode tiket valid
  -- 2. Pendaftar memilih ikut pre_event = true
  -- 3. Panitia sudah verifikasi: payment_status = 'success'
  SELECT EXISTS (
    SELECT 1 FROM public.registrations
    WHERE registration_code = _code
      AND pre_event = true
      AND LOWER(payment_status) = 'success'
  ) INTO has_access;

  IF NOT has_access THEN
    RETURN NULL;
  END IF;

  RETURN 'https://chat.whatsapp.com/KVpE4Qs8cbcD9ElEDgjs5w?s=sh&p=i&ilr=0&amv=0';
END;
$$;

REVOKE ALL ON FUNCTION public.get_pre_event_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_pre_event_link(text) TO anon, authenticated;
