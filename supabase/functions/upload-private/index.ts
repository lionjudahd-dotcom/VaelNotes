// Vael Notes "upload-private": puts the team-only files (the island map scripts) into public.private_files.
// As kept in the repo it refuses everything. To upload, deploy a copy with TOKEN set to the value in
// private/upload-token.txt, POST { files: [{ name, ord, body }] } with header x-upload-token, then deploy
// this file again unchanged so the endpoint goes back to refusing.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "__SET_AT_DEPLOY__";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (TOKEN.startsWith("__") || req.method !== "POST" || req.headers.get("x-upload-token") !== TOKEN) return json(403, { error: "Uploads are off." });
  let b: { files?: { name?: string; ord?: number; body?: string }[] };
  try { b = await req.json(); } catch { return json(400, { error: "Bad request." }); }
  const rows = (b.files ?? []).filter((f) => f && f.name && typeof f.body === "string")
    .map((f) => ({ name: String(f.name), ord: Number(f.ord) || 0, body: f.body as string, updated_at: new Date().toISOString() }));
  if (!rows.length) return json(400, { error: "No files." });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const r = await admin.from("private_files").upsert(rows);
  if (r.error) return json(500, { error: r.error.message });
  return json(200, { ok: true, files: rows.map((x) => x.name + ":" + x.body.length) });
});
