import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import forge from "npm:node-forge@1.3.1";
import { Buffer } from "node:buffer";
import { CancelaNFeUseCase, DefaultXmlSigner } from "npm:@brasil-fiscal/nfe@2.0.7";

const ICP_BRASIL_ROOT_V10_PEM = await Deno.readTextFile(new URL("./icp-brasil-v10.pem", import.meta.url));

type Json = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function str(value: unknown) {
  return String(value ?? "").trim();
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function pemCertificates(value: unknown) {
  const raw = str(value);
  if (!raw) return [] as string[];
  return (raw.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [])
    .map((certificate) => `${certificate.trim()}\n`);
}

function sefazTlsTrust() {
  const custom = pemCertificates(Deno.env.get("SEFAZ_CA_BUNDLE_PEM"));
  return [`${ICP_BRASIL_ROOT_V10_PEM.trim()}\n`, ...custom];
}

function parsePfx(pfxBase64: string, password: string) {
  const binary = forge.util.decode64(pfxBase64);
  const asn1 = forge.asn1.fromDer(binary);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  let privateKey: any = null;
  let certificate: any = null;
  for (const sc of p12.safeContents) {
    for (const bag of sc.safeBags) {
      if (!privateKey && bag.key) privateKey = bag.key;
      if (!certificate && bag.cert) certificate = bag.cert;
    }
  }
  if (!privateKey || !certificate) throw new Error("certificate_key_pair_not_found");
  return {
    pfx: Buffer.from(pfxBase64, "base64"),
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certPem: forge.pki.certificateToPem(certificate),
  };
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("supabase_service_credentials_missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function fiscalEvent(
  supabase: any,
  tenantId: string,
  documentId: string,
  eventType: string,
  level: string,
  message: string,
  code?: string,
  payload: Json = {},
) {
  await supabase.from("fiscal_document_events").insert({
    tenant_id: tenantId,
    fiscal_document_id: documentId,
    event_type: eventType,
    level,
    code: code || null,
    message,
    payload,
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const body = await request.json().catch(() => ({})) as Json;
  const documentId = str(body.document_id);
  const reason = str(body.reason).replace(/\s+/g, " ");
  const accessKind = body.device_token ? "device" : "session";
  const accessToken = str(body.device_token || body.session_token);
  const operatorUserId = str(body.operator_user_id) || null;
  const supervisorUserId = str(body.supervisor_user_id) || null;

  if (!documentId || !accessToken) return json({ ok: false, error: "missing_authorization_context" }, 400);
  if (reason.length < 15 || reason.length > 255) {
    return json({ ok: false, error: "nfce_cancellation_reason_invalid", min: 15, max: 255 }, 400);
  }

  const supabase = await adminClient();
  const { data: claim, error: claimError } = await supabase.rpc("thorfiscal_claim_cancellation", {
    p_access_token: accessToken,
    p_access_kind: accessKind,
    p_document_id: documentId,
    p_reason: reason,
    p_operator_user_id: operatorUserId,
    p_supervisor_user_id: supervisorUserId,
  });
  if (claimError) return json({ ok: false, error: "cancellation_claim_failed", detail: claimError.message }, 500);
  if (!claim?.ok) return json(claim ?? { ok: false, error: "cancellation_claim_failed" }, 400);
  if (claim.already_cancelled) return json({ ...claim, ok: true, cancelled: true, idempotent: true });

  const doc = claim.document ?? {};
  const tenantId = str(doc.tenant_id);
  const accessKey = digits(doc.access_key);
  const protocol = str(doc.protocol);
  const cnpj = digits(claim.cnpj);
  const environment = str(doc.environment) === "production" ? "production" : "homologation";

  let signedEventXml = "";
  let requestEnvelope = "";
  let responseXml = "";
  let endpoint = "";
  let httpStatus = 0;

  try {
    await fiscalEvent(supabase, tenantId, documentId, "cancellation_started", "info", "ThorFiscal iniciou o cancelamento da NFC-e.", undefined, {
      deadline: claim.cancel_deadline,
      operator_user_id: operatorUserId,
    });

    const password = str(claim.certificate?.password);
    const cert = parsePfx(str(claim.certificate?.pfx_base64), password);
    const certificateProvider = {
      load: async () => ({
        pfx: cert.pfx,
        password,
        certPem: cert.certPem,
        privateKey: cert.privateKeyPem,
        notAfter: claim.certificate?.valid_to ? new Date(claim.certificate.valid_to) : new Date(Date.now() + 86400000),
      }),
    };

    const baseSigner = new DefaultXmlSigner();
    const xmlSigner = {
      sign: (xml: string, certificateData: any) => {
        signedEventXml = baseSigner.sign(xml, certificateData as any);
        return signedEventXml;
      },
    };

    const transport = {
      send: async (sefazRequest: any) => {
        endpoint = str(sefazRequest.url);
        requestEnvelope = str(sefazRequest.xml);
        const client = Deno.createHttpClient({
          cert: cert.certPem,
          key: cert.privateKeyPem,
          caCerts: sefazTlsTrust(),
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
          const soapAction = str(sefazRequest.soapAction);
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": `application/soap+xml; charset=UTF-8; action=\"${soapAction}\"`,
              soapaction: soapAction,
            },
            body: requestEnvelope,
            client,
            signal: controller.signal,
          } as any);
          httpStatus = response.status;
          responseXml = await response.text();
          if (!response.ok) throw new Error(`sefaz_event_http_${response.status}`);
          return { status: response.status, xml: responseXml } as any;
        } finally {
          clearTimeout(timer);
          (client as any).close?.();
        }
      },
    };

    const cancellation = new CancelaNFeUseCase({
      certificate: certificateProvider as any,
      transport: transport as any,
      xmlSigner: xmlSigner as any,
      environment: environment as any,
    });

    const result = await cancellation.execute({
      chaveAcesso: accessKey,
      cnpj,
      protocolo: protocol,
      justificativa: escapeXmlText(reason),
    });

    const cancellationAt = result.dhRegEvento || new Date().toISOString();
    const cancellationProtocol = result.nProt || null;
    const responsePayload = {
      ...(doc.response_payload ?? {}),
      cancellation: {
        cStat: result.cStat,
        xMotivo: result.xMotivo,
        protocol: cancellationProtocol,
        registered_at: cancellationAt,
        endpoint,
        http_status: httpStatus,
        signed_event_xml: signedEventXml,
        request_envelope: requestEnvelope,
        raw_response: responseXml,
        reason,
      },
    };

    const { error: updateError } = await supabase.from("fiscal_documents").update({
      status: "cancelled",
      cancellation_protocol: cancellationProtocol,
      cancellation_at: cancellationAt,
      response_payload: responsePayload,
      rejection_code: null,
      rejection_message: null,
      last_error_code: null,
      last_error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", documentId).eq("status", "authorized");
    if (updateError) throw new Error(`cancellation_persist_failed:${updateError.message}`);

    await fiscalEvent(supabase, tenantId, documentId, "cancellation_authorized", "success", result.xMotivo || "Cancelamento autorizado pela SEFAZ.", result.cStat, {
      protocol: cancellationProtocol,
      registered_at: cancellationAt,
      endpoint,
    });

    return json({
      ok: true,
      cancelled: true,
      document_id: documentId,
      status: "cancelled",
      cStat: result.cStat,
      message: result.xMotivo,
      cancellation_protocol: cancellationProtocol,
      cancellation_at: cancellationAt,
      cancel_deadline: claim.cancel_deadline,
    });
  } catch (error) {
    const cStat = str((error as any)?.cStat);
    const xMotivo = str((error as any)?.xMotivo || (error instanceof Error ? error.message : error));
    const retryable = !cStat;
    await fiscalEvent(supabase, tenantId, documentId, retryable ? "cancellation_transmission_error" : "cancellation_rejected", retryable ? "error" : "warning", xMotivo || "Falha no cancelamento fiscal.", cStat || undefined, {
      endpoint,
      http_status: httpStatus,
      raw_response: responseXml,
    });

    const responsePayload = {
      ...(doc.response_payload ?? {}),
      cancellation_last_attempt: {
        cStat: cStat || null,
        xMotivo,
        endpoint,
        http_status: httpStatus,
        signed_event_xml: signedEventXml || null,
        raw_response: responseXml || null,
        attempted_at: new Date().toISOString(),
        reason,
      },
    };
    await supabase.from("fiscal_documents").update({
      response_payload: responsePayload,
      last_error_code: cStat || (retryable ? "cancellation_transmission_error" : null),
      last_error_message: xMotivo || null,
      updated_at: new Date().toISOString(),
    }).eq("id", documentId).eq("status", "authorized");

    return json({
      ok: false,
      cancelled: false,
      document_id: documentId,
      status: "authorized",
      cStat: cStat || undefined,
      message: xMotivo,
      error: cStat ? "nfce_cancellation_rejected" : "nfce_cancellation_transmission_error",
      retryable,
      cancel_deadline: claim.cancel_deadline,
    }, cStat ? 422 : 503);
  }
});
