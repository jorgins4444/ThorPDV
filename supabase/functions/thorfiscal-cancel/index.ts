import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import forge from "npm:node-forge@1.3.1";
import { Buffer } from "node:buffer";
import { CancelaNFeUseCase, DefaultXmlSigner } from "npm:@brasil-fiscal/nfe@2.0.7";

const ICP_BRASIL_ROOT_V10_PEM = `-----BEGIN CERTIFICATE-----
MIIGrDCCBJSgAwIBAgIJANLVi0S/gZNCMA0GCSqGSIb3DQEBDQUAMIGYMQswCQYD
VQQGEwJCUjETMBEGA1UECgwKSUNQLUJyYXNpbDE9MDsGA1UECww0SW5zdGl0dXRv
IE5hY2lvbmFsIGRlIFRlY25vbG9naWEgZGEgSW5mb3JtYWNhbyAtIElUSTE1MDMG
A1UEAwwsQXV0b3JpZGFkZSBDZXJ0aWZpY2Fkb3JhIFJhaXogQnJhc2lsZWlyYSB2
MTAwHhcNMTkwNzAxMTkxNTU5WhcNMzIwNzAxMTIwMDU5WjCBmDELMAkGA1UEBhMC
QlIxEzARBgNVBAoMCklDUC1CcmFzaWwxPTA7BgNVBAsMNEluc3RpdHV0byBOYWNp
b25hbCBkZSBUZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNTAzBgNVBAMM
LEF1dG9yaWRhZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjEwMIIC
IjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAk3AxKl1ZtP0pNyjChqO7qNkn
+/sClZeqiV/Kd7KnnbkDbI2y3VWcUG7feCE/deIxot6GH6JXncRG794UZl+4doD0
D0/cEwBd4DvrDSZm0RT40xhmYYOTxZDJxv+coTHdmsT5aNmSkktfjzYX4HQHh/7M
em+kTOpT/3E4K6B7KVs9HkOT7nXx5yU1qYbVWqI0qpJM9mOTSFx8C9HiKcHvLCvt
1ioXKPAmFuHPkayOcXP2MXeb+VRNjWKU4E+L2t5uZPKVx1M/9i1DztlLb4K8OfYg
GaPDUSF1sxnoGk5qZHLleO6KjCpmuQepmgsBvxi2YNO7X2YUwQQx1AXNSolgtkAR
5gt+1WzxhbFUhItQqlhqxgWHefLmiT5T/Ctz/P2v+zSO4efkkIzsi1iwD+ypZvM2
lnIvB24RcSN6jzmCahLPX4CwjwIK6JsSoMVxIhpZHCguUP4LXqP8IWUZ6WgS/4zB
7B9E0EICl2rM1PRy+6ulv+ZOW256e8a0pijUB+hXM1msUq9L92476FAAX8va3sP7
+Uut94+bGHmubcTLImWUPrxNT7QyrvE3FyHicfiHioeFL2oV4cXTLZrEq2wS8R4P
KPdSzNn5Z9e2uMEGYQaSNO+OwvVycpIhOBOqrm12wJ9ZhWKtM5UOo34/o37r5ZBI
TYXAGbhqQDB9mWXwH+0CAwEAAaOB9jCB8zBOBgNVHSAERzBFMEMGBWBMAQEAMDow
OAYIKwYBBQUHAgEWLGh0dHA6Ly9hY3JhaXouaWNwYnJhc2lsLmdvdi5ici9EUENh
Y3JhaXoucGRmMEAGA1UdHwQ5MDcwNaAzoDGGL2h0dHA6Ly9hY3JhaXouaWNwYnJh
c2lsLmdvdi5ici9MQ1JhY3JhaXp2MTAuY3JsMB8GA1UdIwQYMBaAFHTzfv/8n1N6
8Xzrqz6kptoYukVjMB0GA1UdDgQWBBR0837//J9TevF866s+pKbaGLpFYzAPBgNV
HRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQ0FAAOCAgEA
eCNhBSuy/Ih/T+1VOtAJju85SrtoE3vET1qXASpmjQllDHG/ph7VFNRAkC+gha+B
CbjoA5oJ/8wwl+Qdp1KGz6nXXFTLx3osU+kjm0srmBf9nyXHPqvFyvBeB0A7sYb7
TmII9GKD20oCxsdkccR/oE/JuTaNnGq0GYZ2aDb5v62uLi21Y6P9UBiTxZqQ4ojW
ET6kXNjlK238jpXv17FR8Sg3VusCvX7Q8eJkavvHHZDeWck2fSA+ycAc2JeL2Z0B
MSxGWpH32WM9J8+6XqCJUXHiWEV0zCE8wDYiYC+047pTxQI/gB/FcU7jvylh98DJ
kQPHd/Tp6Og3ynlDA9n9uBbxYHVRZs9vsZ/7xTFaxRe+zk8dhgKgZ/3RrcMFB570
2t8LFbyuUE/kQVY6rZ0QJ9qMWQ7VPLRwRhiMeU3k8WDJb/tBbOXHBqldTbWyQ+mp
MEDWhbrzE/IED82wAuO23Tb05cYk2xC7+Izef8fSc3XdJDuPSbcDpWukzyCDtSEH
isLiGEtIbYRiPsF3czlQPsnIEVoTTCWxHCH1zYR6zScSv18Qh69qVe2J40K5jZoP
GEOhq/oKhVJQAdvAFW5Odp7mF3Tk9nivjjsctJSxY26LFiV5GRV+07SSse4ti0aO
jO5PLg5SWjfcOtBG2rz02EIvQAmLcb0kGBtfdj0lW/w=
-----END CERTIFICATE-----`;

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
        const libraryEndpoint = str(sefazRequest.url);
        endpoint = environment === "production"
          ? "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx"
          : "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx";
        requestEnvelope = str(sefazRequest.xml);
        if (libraryEndpoint !== endpoint) {
          console.log("ThorFiscal NFC-e cancellation endpoint override", { libraryEndpoint, endpoint });
        }
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
