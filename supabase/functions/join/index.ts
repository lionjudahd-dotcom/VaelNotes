// Vael Notes "join": turns an invite into a login, or resets a password the owner has allowed.
// The person picks their own password; no email is sent. Called without a login, so it checks the invite itself.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(400, { error: "Bad request." }); }
  const email = String(b.email ?? "").trim().toLowerCase();
  const code = String(b.code ?? "").trim().toUpperCase();
  const password = String(b.password ?? "");
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Enter a valid email address." });
  if (password.length < 8) return json(400, { error: "Choose a password of at least 8 characters." });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const denied = () => json(403, { error: "That email and invite code don't match an open invite. Check them with the person who invited you." });

  const { data: inv } = await admin.from("invites").select("*").eq("email", email).maybeSingle();
  if (!inv) return denied();
  const { count } = await admin.from("members").select("user_id", { count: "exact", head: true }).eq("role", "owner");
  // The owner sets up without a code while the team has no owner yet; everyone else needs the code from their invite.
  const firstOwner = inv.role === "owner" && (count ?? 0) === 0;
  if (!firstOwner && (!code || inv.code !== code)) return denied();

  const { data: mem } = await admin.from("members").select("user_id").eq("email", email).maybeSingle();
  if (mem) {
    if (!inv.reset_ok) return json(409, { error: "This email already has a login. Sign in instead, or ask the owner to allow a password reset." });
    const { error } = await admin.auth.admin.updateUserById(mem.user_id, { password });
    if (error) return json(400, { error: error.message });
  } else {
    if (inv.used_at && !inv.reset_ok) return denied();
    let userId: string | null = null;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.data?.user) userId = made.data.user.id;
    else {
      // A login can already exist for someone who was removed from the team and is now invited again.
      const { data: existing } = await admin.rpc("auth_user_id", { e: email });
      if (!existing) return json(400, { error: made.error?.message ?? "Could not create the login." });
      const { error } = await admin.auth.admin.updateUserById(existing as string, { password });
      if (error) return json(400, { error: error.message });
      userId = existing as string;
    }
    const { error: e2 } = await admin.from("members").insert({ user_id: userId, email, display_name: name || email.split("@")[0], role: inv.role });
    if (e2) return json(500, { error: "Could not finish setting up the login. Try again." });
  }
  await admin.from("invites").update({ used_at: new Date().toISOString(), reset_ok: false }).eq("email", email);
  return json(200, { ok: true });
});
