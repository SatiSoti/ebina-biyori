import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: Record<string, unknown>, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "origin",
  },
});
const preflight = (origin: string) => new Response(null, { status: 204, headers: {
  "access-control-allow-origin": origin,
  "access-control-allow-headers": "apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
  "vary": "origin",
} });

const allowedOrigin = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
};

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const urlPattern = /^https?:\/\//i;
const keyValues = (name: string) => {
  try { return Object.values(JSON.parse(Deno.env.get(name) || "{}")); }
  catch { return []; }
};

const fingerprint = async (request: Request) => {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const salt = Deno.env.get("RATE_LIMIT_SALT") || "";
  if (!salt) throw new Error("RATE_LIMIT_SALT is not configured");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (request) => {
  const origin = allowedOrigin(request);
  if (!origin) return json({ error: "このサイトからは送信できません。" }, 403, "null");
  if (request.method === "OPTIONS") return preflight(origin);
  if (request.method !== "POST") return json({ error: "送信方法が正しくありません。" }, 405, origin);

  try {
    const suppliedKey = request.headers.get("apikey") || "";
    const acceptedKeys = [...keyValues("SUPABASE_PUBLISHABLE_KEYS"), Deno.env.get("SUPABASE_ANON_KEY") || ""].filter(Boolean);
    if (!suppliedKey || !acceptedKeys.includes(suppliedKey)) return json({ error: "受付キーを確認できません。" }, 401, origin);
    const payload = await request.json();
    if (clean(payload.website, 200)) return json({ ok: true }, 200, origin);

    const submissionType = ["information", "correction", "feedback"].includes(payload.submissionType) ? payload.submissionType : "information";
    const senderName = clean(payload.senderName, 120) || null;
    const senderContact = clean(payload.senderContact, 254) || null;
    const category = clean(payload.category, 80) || null;
    const title = clean(payload.title, 240);
    const summary = clean(payload.summary, 3000);
    const sourceUrl = clean(payload.sourceUrl, 1000) || null;
    const turnstileToken = clean(payload.turnstileToken, 4096);

    if (senderContact && !emailPattern.test(senderContact)) return json({ error: "連絡先メールアドレスをご確認ください。" }, 400, origin);
    if (title.length < 3 || summary.length < 20) return json({ error: "件名と内容をもう少し詳しく入力してください。" }, 400, origin);
    if (sourceUrl && !urlPattern.test(sourceUrl)) return json({ error: "URLは https:// または http:// から入力してください。" }, 400, origin);
    if (payload.consent !== true) return json({ error: "個人情報の取り扱いへの同意が必要です。" }, 400, origin);

    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
    if (!turnstileSecret || !turnstileToken) return json({ error: "迷惑投稿対策の確認を完了してください。" }, 400, origin);
    const verification = new FormData();
    verification.set("secret", turnstileSecret);
    verification.set("response", turnstileToken);
    const remoteIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (remoteIp) verification.set("remoteip", remoteIp);
    const turnstileResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: verification });
    const turnstileResult = await turnstileResponse.json();
    if (!turnstileResult.success || turnstileResult.action !== "submit-information") return json({ error: "迷惑投稿対策の確認に失敗しました。もう一度お試しください。" }, 400, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = String(keyValues("SUPABASE_SECRET_KEYS")[0] || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function secrets are not configured");
    const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const requestFingerprint = await fingerprint(request);
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count, error: countError } = await client.from("information_submissions").select("id", { count: "exact", head: true }).eq("request_fingerprint", requestFingerprint).gte("received_at", since);
    if (countError) throw countError;
    if ((count || 0) >= 3) return json({ error: "短時間に送信できる回数を超えました。時間をおいてお試しください。" }, 429, origin);

    const { error } = await client.from("information_submissions").insert({
      submission_type: submissionType,
      category,
      title,
      sender_name: senderName,
      sender_contact: senderContact,
      source_url: sourceUrl,
      summary,
      status: "unreviewed",
      request_fingerprint: requestFingerprint,
      consented_at: new Date().toISOString(),
    });
    if (error) throw error;
    return json({ ok: true }, 200, origin);
  } catch (error) {
    console.error("submit-information", error);
    return json({ error: "送信を受け付けられませんでした。時間をおいて再度お試しください。" }, 500, origin);
  }
});
