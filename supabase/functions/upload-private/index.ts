// Vael Notes "upload-private": Claude's maintenance door into the database.
//   files:   [{ name, ord, body }]  -> upserts team-only files (the island map scripts) into public.private_files
//   notes:   [{ id, title, folder, body, created_at, updated_at, if_updated_at? }]
//            -> adds a note, or replaces one only if its updated_at still equals if_updated_at (nobody edited it
//               in the app since); the replaced version is kept in note_history
//   inserts: [{ id, after, text }] -> adds text as new lines after the one line containing `after`
//            (skipped if that line isn't there exactly once, or the text is already in the note)
// As kept in the repo it refuses everything. To use it, deploy a copy with TOKEN set to the value in
// private/upload-token.txt, POST with header x-upload-token, then deploy this file again unchanged.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "__SET_AT_DEPLOY__";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Note = { id: string; title: string; folder: string; body: string; created_at?: string; updated_at?: string; if_updated_at?: string };

Deno.serve(async (req: Request) => {
  if (TOKEN.startsWith("__") || req.method !== "POST" || req.headers.get("x-upload-token") !== TOKEN) return json(403, { error: "Uploads are off." });
  let b: { files?: { name?: string; ord?: number; body?: string }[]; notes?: Note[]; inserts?: { id: string; after: string; text: string }[] };
  try { b = await req.json(); } catch { return json(400, { error: "Bad request." }); }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString(), report: string[] = [];

  const rows = (b.files ?? []).filter((f) => f && f.name && typeof f.body === "string")
    .map((f) => ({ name: String(f.name), ord: Number(f.ord) || 0, body: f.body as string, updated_at: now }));
  if (rows.length) {
    const r = await admin.from("private_files").upsert(rows);
    report.push(r.error ? "files: " + r.error.message : "files: " + rows.map((x) => x.name).join(", "));
  }

  const keep = async (old: Record<string, string>) => {
    await admin.from("note_history").insert({ id: crypto.randomUUID(), note_id: old.id, title: old.title, folder: old.folder, body: old.body, saved_at: old.updated_at, replaced_at: now });
  };
  for (const n of b.notes ?? []) {
    const { data: old } = await admin.from("notes").select("*").eq("id", n.id).maybeSingle();
    if (!old) {
      const r = await admin.from("notes").insert({ id: n.id, title: n.title, folder: n.folder, body: n.body, created_at: n.created_at || now, updated_at: n.updated_at || now });
      report.push(n.id + ": " + (r.error ? r.error.message : "added")); continue;
    }
    if (!n.if_updated_at || new Date(old.updated_at).getTime() !== new Date(n.if_updated_at).getTime()) { report.push(n.id + ": skipped, changed in the app"); continue; }
    await keep(old);
    const r = await admin.from("notes").update({ title: n.title, folder: n.folder, body: n.body, updated_at: n.updated_at || now }).eq("id", n.id);
    report.push(n.id + ": " + (r.error ? r.error.message : "replaced"));
  }

  for (const ins of b.inserts ?? []) {
    const { data: old } = await admin.from("notes").select("*").eq("id", ins.id).maybeSingle();
    if (!old) { report.push(ins.id + ": insert skipped, no such note"); continue; }
    if (old.body.includes(ins.text.trim())) { report.push(ins.id + ": insert skipped, already there"); continue; }
    const lines = old.body.split("\n"), hits = lines.map((l: string, i: number) => l.includes(ins.after) ? i : -1).filter((i: number) => i >= 0);
    if (hits.length !== 1) { report.push(ins.id + ": insert skipped, anchor found " + hits.length + " times"); continue; }
    lines.splice(hits[0] + 1, 0, ...ins.text.replace(/\n$/, "").split("\n"));
    await keep(old);
    const r = await admin.from("notes").update({ body: lines.join("\n"), updated_at: now }).eq("id", ins.id);
    report.push(ins.id + ": " + (r.error ? r.error.message : "lines added"));
  }
  return json(200, { ok: true, report });
});
