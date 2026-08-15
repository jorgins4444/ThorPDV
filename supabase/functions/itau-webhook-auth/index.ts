import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const json = (body: unknown, status = 200, extraHeaders: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
});

function parseBasic(header: string) {
  if (!/^Basic\s+/i.test(header)) return null;
  try {
    const decoded = atob(header.replace(/^Basic\s+/i, "").trim());
    const pos = decoded.indexOf(":");
    if (pos < 0) return null;
    return { clientId: decoded.slice(0, pos), clientSecret: decoded.slice(pos + 1) };
  } catch { return null; }
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return `twat_${btoa(raw).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const environment = (url.searchParams.get("environment") || "homologation").toLowerCase();
  if (!["sandbox","homologation","production"].includes(environment)) return json({ error: "invalid_environment" }, 400);

  if (req.method === "GET") {
    const { data } = await db.rpc("edge_bank_webhook_oauth_status", { p_provider: "itau", p_environment: environment });
    return json({ ok: true, service: "ThorGestao Itaú webhook OAuth2", grant_type: "client_credentials", token_endpoint_auth_method: "client_secret_basic", ...data });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = parseBasic(req.headers.get("authorization") || "");
  if (!auth) return json({ error: "invalid_client" }, 401, { "www-authenticate": "Basic realm=itau-webhook" });

  const contentType = req.headers.get("content-type") || "";
  let grantType = "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(await req.text());
    grantType = form.get("grant_type") || "";
  } else {
    try { grantType = String((await req.json())?.grant_type || ""); } catch { grantType = ""; }
  }
  if (grantType !== "client_credentials") return json({ error: "unsupported_grant_type" }, 400);

  const accessToken = randomToken();
  const { data, error } = await db.rpc("edge_bank_webhook_oauth_issue", {
    p_provider: "itau",
    p_environment: environment,
    p_client_id: auth.clientId,
    p_client_secret: auth.clientSecret,
    p_access_token: accessToken,
  });
  if (error) return json({ error: "server_error" }, 500);
  if (!data?.ok) return json({ error: data?.error || "invalid_client" }, 401, { "www-authenticate": "Basic realm=itau-webhook" });

  return json({ access_token: accessToken, token_type: "Bearer", expires_in: 300 });
});
