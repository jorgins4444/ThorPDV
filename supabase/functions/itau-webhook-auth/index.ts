import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const WEBHOOK_SECRET = Deno.env.get("BANK_WEBHOOK_SECRET") || "";
const CLIENT_ID = "thor-itau-hub";

const json = (body: unknown, status = 200, extraHeaders: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  },
});

function safeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}

function b64url(bytes: Uint8Array) {
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function parseBasic(header: string) {
  if (!/^Basic\s+/i.test(header)) return null;
  try {
    const decoded = atob(header.replace(/^Basic\s+/i, "").trim());
    const pos = decoded.indexOf(":");
    if (pos < 0) return null;
    return { clientId: decoded.slice(0, pos), clientSecret: decoded.slice(pos + 1) };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return json({
      ok: true,
      service: "ThorGestao Itaú webhook OAuth2",
      grant_type: "client_credentials",
      token_endpoint_auth_method: "client_secret_basic",
      configured: Boolean(WEBHOOK_SECRET),
    });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!WEBHOOK_SECRET) return json({ error: "temporarily_unavailable" }, 503);

  const auth = parseBasic(req.headers.get("authorization") || "");
  if (!auth || !safeEqual(auth.clientId, CLIENT_ID) || !safeEqual(auth.clientSecret, WEBHOOK_SECRET)) {
    return json({ error: "invalid_client" }, 401, { "www-authenticate": "Basic realm=itau-webhook" });
  }

  const contentType = req.headers.get("content-type") || "";
  let grantType = "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(await req.text());
    grantType = form.get("grant_type") || "";
  } else {
    try {
      const body = await req.json();
      grantType = String(body?.grant_type || "");
    } catch {
      grantType = "";
    }
  }
  if (grantType !== "client_credentials") return json({ error: "unsupported_grant_type" }, 400);

  const exp = Math.floor(Date.now() / 1000) + 300;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const signature = await hmac(`${exp}.${nonce}`);
  const accessToken = `thorwh.v1.${exp}.${nonce}.${signature}`;

  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 300,
  });
});
