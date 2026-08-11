import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import forge from "npm:node-forge@1.3.1";
import { Buffer } from "node:buffer";
import {
  DefaultXmlBuilder,
  DefaultXmlSigner,
  getSefazUrl,
  getNFCeQRCodeUrl,
  getNFCeConsultaUrl,
} from "npm:@brasil-fiscal/nfe@2.0.6";

const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
const SOAP_ACTION = `${NFE_NS}/wsdl/NFeAutorizacao4/nfeAutorizacaoLote`;
const HOMOLOG_PRODUCT = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

// Public trust anchor published by ITI/ICP-Brasil and independently verified against the
// live SVRS chain on 2026-08-11. This augments (never disables) Deno's default TLS roots.
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
const ICP_BRASIL_ROOT_V10_SHA256 = "6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6";
const ICP_BRASIL_ROOT_V10_VALID_TO = "2032-07-01T12:00:59Z";

type Json = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}
function str(value: unknown) {
  return String(value ?? "").trim();
}

function pemCertificates(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return [] as string[];
  return (raw.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [])
    .map((certificate) => `${certificate.trim()}\n`);
}

function sefazTlsTrust() {
  const custom = pemCertificates(Deno.env.get("SEFAZ_CA_BUNDLE_PEM"));
  return {
    caCerts: [`${ICP_BRASIL_ROOT_V10_PEM.trim()}\n`, ...custom],
    diagnostic: {
      default_runtime_roots: true,
      builtin_root: "ICP-Brasil v10",
      builtin_root_sha256: ICP_BRASIL_ROOT_V10_SHA256,
      builtin_root_valid_to: ICP_BRASIL_ROOT_V10_VALID_TO,
      custom_ca_count: custom.length,
    },
  };
}
function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function deepFiscal(productProfile: Json, snapshot: Json): Json {
  const base = productProfile && typeof productProfile === "object" ? productProfile : {};
  const snap = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    ...base,
    ...snap,
    icms: { ...(base.icms ?? {}), ...(snap.icms ?? {}) },
    pis: { ...(base.pis ?? {}), ...(snap.pis ?? {}) },
    cofins: { ...(base.cofins ?? {}), ...(snap.cofins ?? {}) },
    ipi: { ...(base.ipi ?? {}), ...(snap.ipi ?? {}) },
    ibsCbs: { ...(base.ibsCbs ?? base.ibscbs ?? {}), ...(snap.ibsCbs ?? snap.ibscbs ?? {}) },
  };
}

function parseTaxRegime(value: unknown): number {
  const raw = str(value).toLowerCase();
  if (/^[1-4]$/.test(raw)) return Number(raw);
  if (raw.includes("simples")) return raw.includes("excesso") ? 2 : 1;
  if (raw.includes("normal") || raw.includes("real") || raw.includes("presum")) return 3;
  if (raw.includes("mei")) return 4;
  return 0;
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
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certPem: forge.pki.certificateToPem(certificate),
    pfx: Buffer.from(pfxBase64, "base64"),
  };
}

function taxValue(source: Json, ...keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return undefined;
}

function buildProduct(item: Json, index: number, regime: number, homologation: boolean) {
  const product = item.product ?? {};
  const fiscal = deepFiscal(product.fiscal_profile ?? {}, item.fiscal_snapshot ?? {});
  const ncm = digits(taxValue(fiscal, "ncm") ?? product.ncm);
  const cfop = digits(taxValue(fiscal, "cfop", "cfop_default") ?? product.cfop_default);
  const origin = num(taxValue(fiscal, "origin", "origem") ?? product.origin, 0);
  const errors: string[] = [];

  if (ncm.length !== 8) errors.push(`item_${index}_ncm_invalid`);
  if (cfop.length !== 4) errors.push(`item_${index}_cfop_invalid`);
  if (origin < 0 || origin > 8) errors.push(`item_${index}_origin_invalid`);

  const icmsSource = fiscal.icms ?? {};
  const csosn = str(taxValue(icmsSource, "csosn") ?? taxValue(fiscal, "csosn"));
  const cst = str(taxValue(icmsSource, "cst") ?? taxValue(fiscal, "icms_cst", "cst_icms"));
  if ([1, 2, 4].includes(regime)) {
    if (!/^\d{3}$/.test(csosn)) errors.push(`item_${index}_csosn_required`);
  } else if (regime === 3) {
    if (!/^\d{2}$/.test(cst)) errors.push(`item_${index}_icms_cst_required`);
  }

  const pisSource = fiscal.pis ?? {};
  const cofinsSource = fiscal.cofins ?? {};
  const pisCst = str(taxValue(pisSource, "cst") ?? taxValue(fiscal, "pis_cst"));
  const cofinsCst = str(taxValue(cofinsSource, "cst") ?? taxValue(fiscal, "cofins_cst"));
  if (!/^\d{2}$/.test(pisCst)) errors.push(`item_${index}_pis_cst_required`);
  if (!/^\d{2}$/.test(cofinsCst)) errors.push(`item_${index}_cofins_cst_required`);

  const base = Math.max(0, num(item.total) - num(item.discount));
  const icms: Json = {
    origem: origin,
    ...([1, 2, 4].includes(regime) ? { csosn } : { cst }),
  };
  const icmsAliq = taxValue(icmsSource, "aliquota", "pICMS", "percent");
  const icmsBase = taxValue(icmsSource, "baseCalculo", "base_calculo", "vBC");
  const icmsValor = taxValue(icmsSource, "valor", "vICMS");
  if (icmsAliq !== undefined) icms.aliquota = num(icmsAliq);
  if (icmsBase !== undefined) icms.baseCalculo = num(icmsBase);
  if (icmsValor !== undefined) icms.valor = num(icmsValor);

  const pis: Json = { cst: pisCst };
  const pisAliq = taxValue(pisSource, "aliquota", "pPIS");
  const pisBase = taxValue(pisSource, "baseCalculo", "base_calculo", "vBC");
  const pisValor = taxValue(pisSource, "valor", "vPIS");
  if (pisAliq !== undefined) pis.aliquota = num(pisAliq);
  if (pisBase !== undefined) pis.baseCalculo = num(pisBase);
  if (pisValor !== undefined) pis.valor = num(pisValor);

  const cofins: Json = { cst: cofinsCst };
  const cofAliq = taxValue(cofinsSource, "aliquota", "pCOFINS");
  const cofBase = taxValue(cofinsSource, "baseCalculo", "base_calculo", "vBC");
  const cofValor = taxValue(cofinsSource, "valor", "vCOFINS");
  if (cofAliq !== undefined) cofins.aliquota = num(cofAliq);
  if (cofBase !== undefined) cofins.baseCalculo = num(cofBase);
  if (cofValor !== undefined) cofins.valor = num(cofValor);

  const ibsSource = fiscal.ibsCbs ?? {};
  let ibsCbs: Json | undefined;
  if (Object.keys(ibsSource).length) {
    const ibsCst = str(taxValue(ibsSource, "cst"));
    const cClassTrib = digits(taxValue(ibsSource, "cClassTrib", "classificacao"));
    if (!ibsCst || !cClassTrib) errors.push(`item_${index}_ibscbs_incomplete`);
    else {
      ibsCbs = {
        cst: ibsCst,
        cClassTrib,
        pIBSUF: num(taxValue(ibsSource, "pIBSUF", "ibs_uf")),
        pIBSMun: num(taxValue(ibsSource, "pIBSMun", "ibs_mun")),
        pCBS: num(taxValue(ibsSource, "pCBS", "cbs")),
      };
    }
  }

  return {
    errors,
    product: {
      numero: index,
      codigo: str(item.sku || item.product_id || index),
      descricao: homologation ? HOMOLOG_PRODUCT : str(item.description || `ITEM ${index}`),
      ncm,
      cest: digits(taxValue(fiscal, "cest") ?? product.cest) || undefined,
      cfop,
      unidade: str(item.unit || "UN").slice(0, 6),
      quantidade: num(item.quantity),
      valorUnitario: num(item.unit_price),
      valorTotal: num(item.total),
      valorDesconto: num(item.discount) > 0 ? num(item.discount) : undefined,
      icms,
      pis,
      cofins,
      ...(ibsCbs ? { ibsCbs } : {}),
      _base: base,
    },
  };
}

function paymentCode(method: unknown) {
  const m = str(method).toLowerCase();
  const map: Record<string, string> = {
    cash: "01", dinheiro: "01",
    check: "02", cheque: "02",
    credit_card: "03", credito: "03", credit: "03",
    debit_card: "04", debito: "04", debit: "04",
    store_credit: "05", crediario: "05",
    food_voucher: "10", refeicao: "10",
    meal_voucher: "11", alimentacao: "11",
    gift_card: "12", presente: "12",
    fuel_voucher: "13", combustivel: "13",
    boleto: "15",
    bank_slip: "15",
    bank_deposit: "16", deposito: "16",
    transfer: "18", transferencia: "18",
    loyalty: "19", fidelidade: "19",
    cashback: "19",
    no_payment: "90",
    other: "99", outro: "99",
  };
  return map[m] ?? "99";
}

function buildPayments(payments: Json[], saleTotal: number) {
  const valid = (payments ?? []).filter((p) => num(p.amount) > 0);
  if (!valid.length) throw new Error("sale_without_payment");

  const formas = valid.map((p) => {
    const metadata = p.metadata ?? {};
    const method = str(p.method).toLowerCase();
    const pixMode = str(metadata.pix_type ?? metadata.pixType ?? metadata.mode).toLowerCase();
    const pixAuthorization = str(
      metadata.end_to_end_id ?? metadata.endToEndId ?? metadata.e2eid ??
      metadata.autorizacao ?? metadata.cAut ?? p.txid,
    );
    const pixDynamic = method === "pix" && (
      pixMode === "dynamic" || pixMode === "dinamico" ||
      metadata.integrated === true || Boolean(pixAuthorization)
    );

    // IT 2024.002: 17 = PIX dinâmico; 20 = PIX estático.
    // PIX manual/não integrado do ThorPDV deve sair como 20, evitando RV 391.
    const code = method === "pix" ? (pixDynamic ? "17" : "20") : paymentCode(method);
    const out: Json = { formaPagamento: code, valor: num(p.amount) };

    if (code === "03" || code === "04" || code === "17") {
      const explicitIntegration = metadata.tipo_integracao ?? metadata.tpIntegra;
      out.tipoIntegracao = explicitIntegration !== undefined
        ? (num(explicitIntegration, 1) === 2 ? 2 : 1)
        : (metadata.integrated === false ? 2 : 1);

      const cred = digits(metadata.cnpj_credenciadora ?? metadata.cnpjCredenciadora);
      if (cred.length === 14) out.cnpjCredenciadora = cred;
      const bandeira = str(metadata.bandeira ?? metadata.tBand);
      if (bandeira) out.bandeira = bandeira;
      const auth = code === "17"
        ? pixAuthorization
        : str(metadata.autorizacao ?? metadata.cAut ?? p.external_id);
      if (auth) out.autorizacao = auth;
    }
    return out;
  });

  const paid = formas.reduce((sum, p) => sum + num(p.valor), 0);
  const troco = Math.max(
    0,
    (payments ?? []).reduce((sum, p) => sum + num(p.change_amount), 0) || (paid - saleTotal),
  );
  return { pagamentos: formas, ...(troco > 0.00001 ? { troco } : {}) };
}

function buildDestinatario(data: Json) {
  const sale = data.sale ?? {};
  const customer = data.customer ?? {};
  const doc = digits(sale.consumer_document || customer.document);
  if (!doc) return undefined;
  if (![11, 14].includes(doc.length)) throw new Error("consumer_document_invalid");
  return {
    ...(doc.length === 11 ? { cpf: doc } : { cnpj: doc }),
    nome: str(customer.name || "CONSUMIDOR"),
    email: str(customer.email) || undefined,
    indicadorIE: 9,
  };
}

function buildNfe(data: Json) {
  const doc = data.document ?? {};
  const sale = data.sale ?? {};
  const company = data.company ?? {};
  const branch = data.branch ?? {};
  const settings = data.settings ?? {};
  const regime = parseTaxRegime(company.tax_regime);
  if (![1, 2, 3, 4].includes(regime)) throw new Error("tax_regime_invalid");

  const uf = str(branch.state).toUpperCase();
  const cityCode = digits(branch.ibge_city_code);
  const homologation = str(doc.environment || settings.environment) !== "production";
  const environment = homologation ? 2 : 1;

  const errors: string[] = [];
  const products = (data.items ?? []).map((item: Json, idx: number) => {
    const built = buildProduct(item, idx + 1, regime, homologation);
    errors.push(...built.errors);
    return built.product;
  });
  if (errors.length) {
    const e = new Error(`tax_profile_incomplete:${errors.join(",")}`);
    (e as any).validationErrors = errors;
    throw e;
  }

  const cnpj = digits(company.cnpj);
  const ie = digits(company.state_registration);
  const cep = digits(branch.postal_code);
  if (cnpj.length !== 14) throw new Error("company_cnpj_invalid");
  if (!ie) throw new Error("company_ie_required");
  if (cityCode.length !== 7) throw new Error("branch_ibge_city_code_invalid");
  if (cep.length !== 8) throw new Error("branch_postal_code_invalid");

  const saleTotal = num(sale.total);
  return {
    nfe: {
      identificacao: {
        naturezaOperacao: "VENDA AO CONSUMIDOR",
        tipoOperacao: 1,
        destinoOperacao: 1,
        finalidade: 1,
        consumidorFinal: 1,
        presencaComprador: 1,
        uf,
        municipio: cityCode,
        serie: Number(doc.series),
        numero: Number(doc.number),
        dataEmissao: new Date(),
        tipoEmissao: 1,
        tipoImpressao: 4,
        ambiente: environment,
        modelo: "65",
      },
      emitente: {
        cnpj,
        razaoSocial: str(company.legal_name),
        nomeFantasia: str(company.trade_name) || undefined,
        inscricaoEstadual: ie,
        inscricaoMunicipal: digits(company.municipal_registration) || undefined,
        regimeTributario: regime,
        endereco: {
          logradouro: str(branch.street),
          numero: str(branch.number),
          complemento: str(branch.complement) || undefined,
          bairro: str(branch.district),
          codigoMunicipio: cityCode,
          municipio: str(branch.city),
          uf,
          cep,
          codigoPais: "1058",
          pais: "Brasil",
          telefone: digits(company.phone) || undefined,
        },
      },
      destinatario: buildDestinatario(data),
      produtos: products.map(({ _base, ...p }: Json) => p),
      transporte: { modalidadeFrete: 9 },
      pagamento: buildPayments(data.payments ?? [], saleTotal),
      informacoesComplementares: "NFC-e emitida pelo ThorPDV / ThorFiscal",
    },
    uf,
    homologation,
    environment,
  };
}

function accessKeyFromXml(xml: string) {
  const m = xml.match(/Id="NFe(\d{44})"/);
  if (!m) throw new Error("access_key_not_generated");
  return m[1];
}

function insertQrV3(signedXml: string, uf: string, homologation: boolean, tpAmb: number, accessKey: string) {
  const env = homologation ? "homologacao" : "producao";
  // SEFAZ-PI validates the QR-Code base URL literally (RV 395).
  // The published PI NFC-e endpoints use http:// in Grupo ZX.
  const isPiaui = String(uf).trim().toUpperCase() === "PI";
  const qrBase = isPiaui
    ? "http://www.sefaz.pi.gov.br/nfce/qrcode"
    : getNFCeQRCodeUrl(uf, env as any);
  const consulta = isPiaui
    ? "http://www.sefaz.pi.gov.br/nfce/consulta"
    : getNFCeConsultaUrl(uf, env as any);

  // NT 2025.001 / MOC vigente: no QR-Code v3, tpAmb continua sendo o 3º parâmetro.
  // Emissão on-line (tpEmis=1): <chave_acesso>|3|<tpAmb>, sem CSC/hash.
  const qr = `${qrBase}${qrBase.includes("?") ? "&" : "?"}p=${accessKey}|3|${tpAmb}`;
  const supl = `<infNFeSupl><qrCode><![CDATA[${qr}]]></qrCode><urlChave>${consulta}</urlChave></infNFeSupl>`;

  // O schema TNFe exige a sequência: infNFe, infNFeSupl (opcional), Signature.
  // O signer adiciona Signature após infNFe; portanto inserimos o suplemento imediatamente
  // antes da assinatura, sem alterar o conteúdo de infNFe que já foi assinado.
  const baseXml = signedXml.replace(/<infNFeSupl\b[\s\S]*?<\/infNFeSupl>/i, "");
  const signature = /<(?:\w+:)?Signature\b/.exec(baseXml);
  if (!signature || signature.index === undefined) throw new Error("nfce_signature_not_found_for_supplement");

  return {
    xml: `${baseXml.slice(0, signature.index)}${supl}${baseXml.slice(signature.index)}`,
    qr,
  };
}

function buildEnvelope(signedXml: string) {
  const inner = signedXml.replace(/<\?xml[^?]*\?>\s*/g, "");
  return [
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    "<soap:Body>",
    `<nfeDadosMsg xmlns="${NFE_NS}/wsdl/NFeAutorizacao4">`,
    `<enviNFe versao="4.00" xmlns="${NFE_NS}">`,
    `<idLote>${Date.now()}</idLote>`,
    "<indSinc>1</indSinc>",
    inner,
    "</enviNFe>",
    "</nfeDadosMsg>",
    "</soap:Body>",
    "</soap:Envelope>",
  ].join("");
}

function xmlTag(xml: string, name: string) {
  const re = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, "i");
  return re.exec(xml)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
}

function parseAuthorization(xml: string) {
  const prot = /<(?:\w+:)?protNFe\b[^>]*>[\s\S]*?<\/(?:\w+:)?protNFe>/i.exec(xml)?.[0] ?? "";
  if (prot) {
    return {
      cStat: xmlTag(prot, "cStat"),
      xMotivo: xmlTag(prot, "xMotivo"),
      nProt: xmlTag(prot, "nProt") || undefined,
      chNFe: xmlTag(prot, "chNFe") || undefined,
      dhRecbto: xmlTag(prot, "dhRecbto") || undefined,
      protNFe: prot.replace(/<(\/?)(?:\w+:)(?=[A-Za-z])/g, "<$1"),
    };
  }
  return {
    cStat: xmlTag(xml, "cStat"),
    xMotivo: xmlTag(xml, "xMotivo"),
    nProt: undefined,
    chNFe: undefined,
    dhRecbto: undefined,
    protNFe: "",
  };
}

function classifyTransmissionError(message: string) {
  if (/UnknownIssuer/i.test(message)) return { code: "tls_unknown_issuer", userMessage: "A cadeia do certificado TLS do servidor da SEFAZ não foi reconhecida pelo ambiente de transmissão." };
  if (/timeout|timed out|AbortError/i.test(message)) return { code: "sefaz_timeout", userMessage: "A SEFAZ não respondeu dentro do tempo limite da transmissão." };
  const http = /sefaz_http_(\d{3})/i.exec(message);
  if (http) return { code: `sefaz_http_${http[1]}`, userMessage: `O Web Service da SEFAZ respondeu HTTP ${http[1]}.` };
  if (/certificate|certificado|tls|ssl/i.test(message)) return { code: "tls_error", userMessage: "Falha na negociação TLS/certificado durante a conexão com a SEFAZ." };
  if (/connect|connection|dns|network|sending request/i.test(message)) return { code: "sefaz_connection_error", userMessage: "Não foi possível estabelecer comunicação com o Web Service da SEFAZ." };
  return { code: "transport_or_processing_error", userMessage: "Falha durante a preparação ou transmissão da NFC-e." };
}

async function fiscalEvent(
  supabase: any,
  tenantId: string,
  documentId: string,
  eventType: string,
  level: "info" | "success" | "warning" | "error",
  message: string,
  code?: string,
  payload: Json = {},
) {
  if (!tenantId || !documentId) return;
  const { error } = await supabase.from("fiscal_document_events").insert({
    tenant_id: tenantId,
    fiscal_document_id: documentId,
    event_type: eventType,
    level,
    code: code || null,
    message,
    payload,
  });
  if (error) console.error("fiscal_event_insert_failed", eventType, error.message);
}

function buildNfeProc(signedXml: string, protNFe: string) {
  const nfe = signedXml.replace(/<\?xml[^?]*\?>\s*/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="${NFE_NS}">${nfe}${protNFe}</nfeProc>`;
}

async function transmit(signedXml: string, uf: string, homologation: boolean, certPem: string, privateKeyPem: string) {
  const environment = homologation ? "homologacao" : "producao";
  const url = getSefazUrl(uf, environment as any, "NFCeAutorizacao" as any);
  if (!url) throw new Error("sefaz_nfce_endpoint_not_configured");

  const tlsTrust = sefazTlsTrust();
  const clientOptions: any = {
    cert: certPem,
    key: privateKeyPem,
    // caCerts are additional trust anchors; certificate/hostname validation remains enabled.
    caCerts: tlsTrust.caCerts,
  };
  const client = Deno.createHttpClient(clientOptions);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": `application/soap+xml; charset=UTF-8; action="${SOAP_ACTION}"`,
          "soapaction": SOAP_ACTION,
        },
        body: buildEnvelope(signedXml),
        client,
        signal: controller.signal,
      } as any);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw new Error("sefaz_timeout_30000ms");
      throw error;
    }
    const body = await response.text();
    if (!response.ok) throw new Error(`sefaz_http_${response.status}:${body.slice(0, 500)}`);
    return { body, url, httpStatus: response.status, tlsTrust: tlsTrust.diagnostic };
  } finally {
    clearTimeout(timer);
    (client as any).close?.();
  }
}

async function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("supabase_service_credentials_missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const documentId = str(body.document_id);
  const accessKind = body.device_token ? "device" : "session";
  const accessToken = str(body.device_token || body.session_token);
  if (!documentId || !accessToken) return json({ ok: false, error: "missing_authorization_context" }, 400);

  const supabase = await adminClient();

  const { data: claim, error: claimError } = await supabase.rpc("thorfiscal_claim_document", {
    p_access_token: accessToken,
    p_access_kind: accessKind,
    p_document_id: documentId,
  });
  if (claimError) return json({ ok: false, error: "claim_failed", detail: claimError.message }, 500);
  if (!claim?.ok) return json(claim ?? { ok: false, error: "claim_failed" }, 400);
  if (claim.already_authorized) return json(claim);

  const doc = claim.document ?? {};
  const tenantId = str(doc.tenant_id);
  let signedXml = str(doc.request_payload?.signed_xml || claim.document?.request_payload?.signed_xml);
  let accessKey = str(doc.access_key);
  let qrCodeUrl = str(doc.request_payload?.qr_code_url);
  const previousStatus = str(doc.status);
  const canReuseStagedXml = ["processing", "transmission_error"].includes(previousStatus) && Boolean(signedXml && accessKey);

  try {
    await fiscalEvent(supabase, tenantId, documentId, "authorization_started", "info", "ThorFiscal iniciou a autorização da NFC-e.", undefined, { previous_status: previousStatus, reuse_signed_xml: canReuseStagedXml });
    const cert = parsePfx(claim.certificate.pfx_base64, claim.certificate.password);
    await fiscalEvent(supabase, tenantId, documentId, "certificate_ready", "info", "Certificado A1 carregado para assinatura e mTLS.");

    if (!canReuseStagedXml) {
      await fiscalEvent(supabase, tenantId, documentId, "building_xml", "info", "Montando e validando os dados do XML da NFC-e.");
      const built = buildNfe(claim);
      const builder = new DefaultXmlBuilder();
      const signer = new DefaultXmlSigner();
      const unsignedXml = builder.build(built.nfe as any);
      const signedBase = signer.sign(unsignedXml, {
        pfx: cert.pfx,
        password: claim.certificate.password,
        certPem: cert.certPem,
        privateKey: cert.privateKeyPem,
      } as any);
      accessKey = accessKeyFromXml(signedBase);
      const withQr = insertQrV3(signedBase, built.uf, built.homologation, built.environment, accessKey);
      signedXml = withQr.xml;
      qrCodeUrl = withQr.qr;

      const stagedPayload = {
        ...(doc.request_payload ?? {}),
        signed_xml: signedXml,
        qr_code_url: qrCodeUrl,
        access_key: accessKey,
        qr_version: 3,
        staged_at: new Date().toISOString(),
      };
      const { error: stageError } = await supabase
        .from("fiscal_documents")
        .update({
          access_key: accessKey,
          request_payload: stagedPayload,
          provider: "svrs_direct",
          provider_reference: "thorfiscal_edge_v1",
          status: "processing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      if (stageError) throw new Error(`stage_failed:${stageError.message}`);
      await fiscalEvent(supabase, tenantId, documentId, "xml_signed", "success", "XML gerado e assinado digitalmente.", undefined, { access_key: accessKey });
    } else {
      await fiscalEvent(supabase, tenantId, documentId, "xml_reused", "info", "Reutilizando o mesmo XML assinado e a mesma chave após falha de comunicação.", undefined, { access_key: accessKey });
    }

    const uf = str(claim.branch.state).toUpperCase();
    const homologation = str(doc.environment || claim.settings?.environment) !== "production";
    const attemptCount = num(doc.attempt_count) + 1;
    await supabase.from("fiscal_documents").update({
      status: "processing",
      last_attempt_at: new Date().toISOString(),
      attempt_count: attemptCount,
      last_error_code: null,
      last_error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", documentId);
    await fiscalEvent(supabase, tenantId, documentId, "sending_to_sefaz", "info", "Enviando NFC-e ao Web Service autorizador da SEFAZ.", undefined, { attempt: attemptCount, environment: homologation ? "homologation" : "production", uf });

    const transmitted = await transmit(signedXml, uf, homologation, cert.certPem, cert.privateKeyPem);
    const result = parseAuthorization(transmitted.body);
    await fiscalEvent(supabase, tenantId, documentId, "sefaz_response", result.cStat === "100" || result.cStat === "150" ? "success" : "warning", result.xMotivo || "A SEFAZ retornou uma resposta sem xMotivo.", result.cStat || undefined, { http_status: transmitted.httpStatus, endpoint: transmitted.url });
    const authorized = result.cStat === "100" || result.cStat === "150";

    if (authorized) {
      const protocolXml = result.protNFe;
      const authorizedXml = protocolXml ? buildNfeProc(signedXml, protocolXml) : signedXml;
      const authorizedAt = result.dhRecbto || new Date().toISOString();
      const { error: updateError } = await supabase
        .from("fiscal_documents")
        .update({
          status: "authorized",
          access_key: result.chNFe || accessKey,
          protocol: result.nProt || null,
          authorization_at: authorizedAt,
          rejection_code: null,
          rejection_message: null,
          last_error_code: null,
          last_error_message: null,
          provider: "svrs_direct",
          provider_reference: result.nProt || "thorfiscal_edge_v1",
          xml_path: `/api/pdv/fiscal/${documentId}/xml`,
          pdf_path: `/api/pdv/fiscal/${documentId}/danfe`,
          response_payload: {
            authorized: true,
            cStat: result.cStat,
            xMotivo: result.xMotivo,
            protocol: result.nProt,
            access_key: result.chNFe || accessKey,
            authorized_xml: authorizedXml,
            signed_xml: signedXml,
            qr_code_url: qrCodeUrl,
            sefaz_endpoint: transmitted.url,
            tls_trust: transmitted.tlsTrust,
            raw_response: transmitted.body,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      if (updateError) throw new Error(`authorization_persist_failed:${updateError.message}`);
      await fiscalEvent(supabase, tenantId, documentId, "authorized", "success", result.xMotivo || "NFC-e autorizada pela SEFAZ.", result.cStat || "100", { protocol: result.nProt || null, access_key: result.chNFe || accessKey });

      return json({
        ok: true,
        authorized: true,
        status: "authorized",
        document_id: documentId,
        access_key: result.chNFe || accessKey,
        protocol: result.nProt,
        authorization_at: authorizedAt,
        cStat: result.cStat,
        message: result.xMotivo,
        qr_code_url: qrCodeUrl,
      });
    }

    await supabase
      .from("fiscal_documents")
      .update({
        status: "rejected",
        rejection_code: result.cStat || "unknown",
        rejection_message: result.xMotivo || "Rejeição sem motivo informado",
        last_error_code: null,
        last_error_message: null,
        response_payload: {
          authorized: false,
          cStat: result.cStat,
          xMotivo: result.xMotivo,
          access_key: accessKey,
          signed_xml: signedXml,
          qr_code_url: qrCodeUrl,
          sefaz_endpoint: transmitted.url,
          tls_trust: transmitted.tlsTrust,
          raw_response: transmitted.body,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    await fiscalEvent(supabase, tenantId, documentId, "rejected", "error", result.xMotivo || "NFC-e rejeitada pela SEFAZ.", result.cStat || "unknown", { access_key: accessKey, endpoint: transmitted.url });

    return json({
      ok: false,
      authorized: false,
      status: "rejected",
      document_id: documentId,
      access_key: accessKey,
      cStat: result.cStat,
      error: "sefaz_rejection",
      message: result.xMotivo,
    }, 422);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const validationErrors = (error as any)?.validationErrors;
    const isValidation = message.startsWith("tax_profile_incomplete:") ||
      /(_invalid|_required|_incomplete|sale_without_payment|tax_regime)/.test(message);
    const transmission = classifyTransmissionError(message);
    const status = isValidation ? "rejected" : "transmission_error";

    await supabase
      .from("fiscal_documents")
      .update({
        status,
        rejection_code: isValidation ? "local_validation" : null,
        rejection_message: isValidation ? message : null,
        last_error_code: isValidation ? null : transmission.code,
        last_error_message: isValidation ? null : message,
        response_payload: {
          authorized: false,
          error: isValidation ? "local_validation" : "transport_or_processing_error",
          transport_code: isValidation ? null : transmission.code,
          user_message: isValidation ? null : transmission.userMessage,
          detail: message,
          validation_errors: validationErrors ?? null,
          access_key: accessKey || null,
          signed_xml: signedXml || null,
          qr_code_url: qrCodeUrl || null,
          retry_same_xml: !isValidation && Boolean(signedXml && accessKey),
          tls_trust: sefazTlsTrust().diagnostic,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    await fiscalEvent(
      supabase,
      tenantId,
      documentId,
      isValidation ? "local_validation_error" : "transport_error",
      "error",
      isValidation ? message : `${transmission.userMessage} Detalhe técnico: ${message}`,
      isValidation ? "local_validation" : transmission.code,
      { retryable: !isValidation, access_key: accessKey || null, tls_trust: sefazTlsTrust().diagnostic },
    );

    return json({
      ok: false,
      authorized: false,
      status,
      document_id: documentId,
      access_key: accessKey || null,
      error: isValidation ? "local_validation" : "transmission_failed",
      error_code: isValidation ? "local_validation" : transmission.code,
      message: isValidation ? message : transmission.userMessage,
      detail: message,
      validation_errors: validationErrors ?? undefined,
      retryable: !isValidation,
    }, isValidation ? 400 : 502);
  }
});
