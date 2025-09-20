// supabase/functions/admin-create-staff/index.ts
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://baikuk-map.netlify.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url  = Deno.env.get("PROJECT_URL")!;
    const anon = Deno.env.get("ANON_KEY")!;
    const sKey = Deno.env.get("SERVICE_ROLE_KEY")!;

    // 호출자 인증(프론트에서 invoke하면 자동으로 Authorization 헤더가 옴)
    const supa = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user: caller } } = await supa.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "not_authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 내 권한
    const { data: me, error: meErr } = await supa
      .from("staff_profiles")
      .select("authority, affiliation")
      .eq("user_id", caller.id)
      .single();
    if (meErr || !me) {
      return new Response(JSON.stringify({ error: "profile_not_found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 요청 바디
    const { email, password, profile } = await req.json();
    if (!email || !password || !profile?.name) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 권한 규칙: 관리자=모두 OK / 지점장=같은 부서의 '직원'만 생성
    const isAdmin   = me.authority === "관리자";
    const isManager = me.authority === "지점장";
    const okByMgr   = isManager &&
                      profile?.authority === "직원" &&
                      profile?.affiliation === me.affiliation;

    if (!isAdmin && !okByMgr) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 서비스롤로 Auth 사용자 생성 + 프로필 insert
    const admin = createClient(url, sKey);

    const { data: created, error: signErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // 필요에 따라 false로
    });
    if (signErr) throw signErr;

    const user_id = created.user?.id;
    if (!user_id) throw new Error("no_user_id");

    const toInsert = { user_id, ...profile, email };
    const { error: insErr } = await admin.from("staff_profiles").insert(toInsert);
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ ok: true, user_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
