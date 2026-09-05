// Prime Shore Bank — register Edge Function.
// Contract (matches register.html): POST { email, password, full_name } with the site anon key
// → creates the auth user on `SUPABASE_URL`, ensures a `profiles` row (10-digit numeric account_number),
// → returns { access_token, refresh_token, user } for sb.auth.setSession. Service-role key is
// read server-side from SUPA_SERVICE_ROLE_KEY env ONLY — never exposed to the client.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SUPA_URL") || "";
  const SERVICE_KEY = Deno.env.get("SUPA_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers: corsHeaders });
  }

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: corsHeaders }); }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const fullName = String(body.full_name || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return new Response(JSON.stringify({ error: "Enter a valid email address." }), { status: 400, headers: corsHeaders });
  if (password.length < 6) return new Response(JSON.stringify({ error: "Password must be at least 6 characters." }), { status: 400, headers: corsHeaders });
  if (!fullName) return new Response(JSON.stringify({ error: "Please enter your full name." }), { status: 400, headers: corsHeaders });

  const authHeader = { "apikey": SERVICE_KEY, "Authorization": "Bearer " + SERVICE_KEY, "Content-Type": "application/json" };

  async function callJson(method: string, path: string, payload?: any): Promise<{ ok: boolean; status: number; data: any }> {
    const r = await fetch(SUPABASE_URL + path, { method, headers: authHeader, body: payload ? JSON.stringify(payload) : undefined });
    const txt = await r.text(); let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch {}
    return { ok: r.ok, status: r.status, data: j };
  }

  try {
    // 1. create auth user (bypasses email confirmation + rate limits exactly like the source)
    const created = await callJson("POST", "/auth/v1/admin/users", {
      email, password, email_confirm: true,
      user_metadata: { full_name: fullName }
    });
    if (!created.ok) {
      return new Response(JSON.stringify({ error: created.data.msg || created.data.message || "Registration failed. Please try again." }), { status: 400, headers: corsHeaders });
    }
    const user = created.data;

    // 2. sign in to mint real tokens (setSession expects them)
    const tok = await callJson("POST", "/auth/v1/token?grant_type=password", { email, password });
    if (!tok.ok) {
      return new Response(JSON.stringify({ error: tok.data.msg || "Account created; please sign in." }), { status: 200, headers: corsHeaders });
    }

    // 3. ensure a profiles row exists (the signup trigger usually mints it
    // with a 10-digit numeric account_number; PostgREST on_conflict no-ops if it did)
    const prof = await callJson("POST", "/rest/v1/profiles?on_conflict=id", {
      id: user.id, email, full_name: fullName, role: "user", status: "active"
    });
    if (!prof.ok) {
      // non-fatal — the trigger usually already created the row, and login
      // auto-creates a bare row as a last resort.


    }

    return new Response(JSON.stringify({
      access_token: tok.data.access_token,
      refresh_token: tok.data.refresh_token,
      user: { id: user.id, email: user.email, user_metadata: user.user_metadata }
    }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Registration failed. Please try again." }), { status: 500, headers: corsHeaders });
  }
});