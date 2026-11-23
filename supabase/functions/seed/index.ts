// Vael Notes "seed" is retired: the one-time import ran on 2026-11-23. This stub refuses every request.
// The original import code is in git history (commit 60bb570).
Deno.serve(() => new Response(JSON.stringify({ error: "The import has already run." }), { status: 410, headers: { "Content-Type": "application/json" } }));
