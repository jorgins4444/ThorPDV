import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BANK_WEBHOOK_SECRET") || "";
const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
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

function getPath(obj: any, path: string): unknown {
  return path.split(".").reduce((cur: any, key) => cur && typeof cur === "object" ? cur[key] : undefined, obj);
}

function pick(obj: any, paths: string[]) {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function text(v: unknown) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function amount(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return undefined;
  const raw = v.trim().replace(/\s/g, "");
  if (!raw) return undefined;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(",", ".");
  const n = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function isoDate(v: unknown) {
  const s = text(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalize(payload: any, req: Request) {
  const paymentStatus = text(pick(payload, [
    "payment_status", "paymentStatus", "status", "situacao", "situacao_pagamento",
    "payment.status", "pagamento.status", "cobranca.status", "boleto.status", "evento.status",
  ]));
  const eventType = text(pick(payload, [
    "event_type", "eventType", "type", "tipo", "tipo_evento", "evento.tipo", "notification.type",
  ])) || paymentStatus || "unknown";
  const paymentChannel = text(pick(payload, [
    "payment_channel", "paymentChannel", "channel", "canal", "meio_pagamento", "payment.method", "pagamento.meio",
  ])) || (text(pick(payload, ["pix_txid", "txid", "pix.txid", "pagamento.txid"])) ? "pix" : "boleto");

  return {
    event_type: eventType,
    payment_status: paymentStatus || eventType,
    payment_channel: paymentChannel,
    billing_id: text(pick(payload, ["billing_id", "billingId", "metadata.billing_id"])),
    our_number: text(pick(payload, [
      "our_number", "ourNumber", "nosso_numero", "nossoNumero", "numero_titulo", "numeroTitulo",
      "boleto.nosso_numero", "boleto.nossoNumero", "cobranca.nosso_numero", "cobranca.nossoNumero",
    ])),
    external_id: text(pick(payload, [
      "external_id", "externalId", "id_titulo", "idTitulo", "billing.external_id", "cobranca.id", "boleto.id",
    ])),
    pix_txid: text(pick(payload, ["pix_txid", "pixTxid", "txid", "pix.txid", "pagamento.txid"])),
    correlation_id: text(req.headers.get("x-itau-correlationid")) || text(req.headers.get("x-correlation-id")) || text(pick(payload, ["correlation_id", "correlationId"])),
    amount: amount(pick(payload, [
      "paid_amount", "paidAmount", "valor_pago", "valorPago", "amount", "valor",
      "payment.amount", "pagamento.valor", "pagamento.valor_pago", "liquidacao.valor",
    ])),
    paid_at: isoDate(pick(payload, [
      "paid_at", "paidAt", "payment_date", "paymentDate", "data_pagamento", "dataPagamento",
      "data_liquidacao", "dataLiquidacao", "payment.date", "pagamento.data", "liquidacao.data",
    ])),
  };
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, service: "ThorGestao bank payment webhook", authentication: WEBHOOK_SECRET ? "configured" : "not_configured" });
  }
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!WEBHOOK_SECRET) return json({ ok: false, error: "webhook_secret_not_configured" }, 503);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const headerSecret = (req.headers.get("x-thor-webhook-secret") || "").trim();
  const candidate = headerSecret || bearer;
  if (!candidate || !safeEqual(candidate, WEBHOOK_SECRET)) return json({ ok: false, error: "unauthorized_webhook" }, 401);

  const raw = await req.text();
  let payload: any;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const provider = (text(req.headers.get("x-thor-bank-provider")) || text(payload.provider) || "itau")!.toLowerCase();
  const environmentRaw = (text(req.headers.get("x-thor-bank-environment")) || text(payload.environment) || "production")!.toLowerCase();
  const environment = environmentRaw === "sandbox" ? "sandbox" : "production";
  const normalized = normalize(payload, req);
  const eventId = text(pick(payload, ["event_id", "eventId", "notification_id", "notificationId", "id_evento", "idEvento", "evento.id"]))
    || normalized.correlation_id
    || await sha256(raw || JSON.stringify(payload));

  const { data, error } = await db.rpc("bank_webhook_receive", {
    p_provider: provider,
    p_environment: environment,
    p_event_id: eventId,
    p_event_type: normalized.event_type,
    p_payload: payload,
    p_normalized: normalized,
  });

  if (error) return json({ ok: false, error: "webhook_database_error", detail: error.message }, 500);
  if (!data?.ok && data?.error === "bank_billing_not_found") return json(data, 202);
  if (!data?.ok) return json(data || { ok: false, error: "webhook_processing_failed" }, 422);
  return json(data, 200);
});
