#!/usr/bin/env node
/**
 * Generates public/env.js from environment variables so that static HTML
 * files under /public can read runtime config via window.__ENV.
 *
 * Variables read (first non-empty wins):
 *   - VITE_SUPABASE_URL       | SUPABASE_URL
 *   - VITE_SUPABASE_ANON_KEY  | SUPABASE_PUBLISHABLE_KEY | SUPABASE_ANON_KEY
 *
 * The file public/env.js MUST be gitignored — it contains the values
 * injected by the hosting platform (e.g. Vercel env vars) at build time.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, "..", "public", "env.js");

const url =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const anon =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

if (!url || !anon) {
  console.warn(
    "[generate-env] WARNING: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. " +
      "public/env.js will be generated with empty values; static pages that talk to Supabase will fail until env vars are configured."
  );
}

const body =
  "// AUTO-GENERATED at build time by scripts/generate-env.mjs. DO NOT COMMIT.\n" +
  "window.__ENV = Object.freeze(" +
  JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: anon }) +
  ");\n";

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body, "utf8");
console.log(`[generate-env] wrote ${out}`);
