from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/thorfiscal-authorize/index.ts"
CA_FILE = ROOT / "supabase/functions/thorfiscal-authorize/icp-brasil-v10.pem"
ERP = ROOT / "src/app/dashboard/[...slug]/fiscal-workspace.tsx"

ROOT_SHA256 = "6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6"
ROOT_VALID_TO = "2032-07-01T12:00:59Z"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


pem = CA_FILE.read_text(encoding="utf-8").strip()
if not pem.startswith("-----BEGIN CERTIFICATE-----") or not pem.endswith("-----END CERTIFICATE-----"):
    raise SystemExit("invalid ICP-Brasil v10 PEM asset")

edge = EDGE.read_text(encoding="utf-8")

constant_anchor = 'const HOMOLOG_PRODUCT = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";\n'
constant_block = constant_anchor + f'''\n// Public trust anchor published by ITI/ICP-Brasil and independently verified against the\n// live SVRS chain on 2026-08-11. This augments (never disables) Deno's default TLS roots.\nconst ICP_BRASIL_ROOT_V10_PEM = `{pem}`;\nconst ICP_BRASIL_ROOT_V10_SHA256 = "{ROOT_SHA256}";\nconst ICP_BRASIL_ROOT_V10_VALID_TO = "{ROOT_VALID_TO}";\n'''
edge = replace_once(edge, constant_anchor, constant_block, "insert ICP-Brasil trust anchor")

str_anchor = '''function str(value: unknown) {\n  return String(value ?? "").trim();\n}\n'''
str_block = str_anchor + '''\nfunction pemCertificates(value: unknown) {\n  const raw = String(value ?? "").trim();\n  if (!raw) return [] as string[];\n  return (raw.match(/-----BEGIN CERTIFICATE-----[\\s\\S]*?-----END CERTIFICATE-----/g) ?? [])\n    .map((certificate) => `${certificate.trim()}\\n`);\n}\n\nfunction sefazTlsTrust() {\n  const custom = pemCertificates(Deno.env.get("SEFAZ_CA_BUNDLE_PEM"));\n  return {\n    caCerts: [`${ICP_BRASIL_ROOT_V10_PEM.trim()}\\n`, ...custom],\n    diagnostic: {\n      default_runtime_roots: true,\n      builtin_root: "ICP-Brasil v10",\n      builtin_root_sha256: ICP_BRASIL_ROOT_V10_SHA256,\n      builtin_root_valid_to: ICP_BRASIL_ROOT_V10_VALID_TO,\n      custom_ca_count: custom.length,\n    },\n  };\n}\n'''
edge = replace_once(edge, str_anchor, str_block, "insert TLS trust helpers")

old_transport = '''  const caBundle = str(Deno.env.get("SEFAZ_CA_BUNDLE_PEM"));\n  const clientOptions: any = { cert: certPem, key: privateKeyPem };\n  if (caBundle) clientOptions.caCerts = [caBundle];\n  const client = Deno.createHttpClient(clientOptions);\n'''
new_transport = '''  const tlsTrust = sefazTlsTrust();\n  const clientOptions: any = {\n    cert: certPem,\n    key: privateKeyPem,\n    // caCerts are additional trust anchors; certificate/hostname validation remains enabled.\n    caCerts: tlsTrust.caCerts,\n  };\n  const client = Deno.createHttpClient(clientOptions);\n'''
edge = replace_once(edge, old_transport, new_transport, "replace Deno TLS client roots")

edge = replace_once(
    edge,
    '    return { body, url, httpStatus: response.status };',
    '    return { body, url, httpStatus: response.status, tlsTrust: tlsTrust.diagnostic };',
    "return TLS diagnostic",
)

edge = replace_once(
    edge,
    '''            sefaz_endpoint: transmitted.url,\n            raw_response: transmitted.body,\n''',
    '''            sefaz_endpoint: transmitted.url,\n            tls_trust: transmitted.tlsTrust,\n            raw_response: transmitted.body,\n''',
    "persist authorized TLS diagnostic",
)
edge = replace_once(
    edge,
    '''          sefaz_endpoint: transmitted.url,\n          raw_response: transmitted.body,\n''',
    '''          sefaz_endpoint: transmitted.url,\n          tls_trust: transmitted.tlsTrust,\n          raw_response: transmitted.body,\n''',
    "persist rejected TLS diagnostic",
)

catch_payload = '''          retry_same_xml: !isValidation && Boolean(signedXml && accessKey),\n'''
catch_payload_new = '''          retry_same_xml: !isValidation && Boolean(signedXml && accessKey),\n          tls_trust: sefazTlsTrust().diagnostic,\n'''
edge = replace_once(edge, catch_payload, catch_payload_new, "persist failed TLS diagnostic")

catch_event = '''      { retryable: !isValidation, access_key: accessKey || null },\n'''
catch_event_new = '''      { retryable: !isValidation, access_key: accessKey || null, tls_trust: sefazTlsTrust().diagnostic },\n'''
edge = replace_once(edge, catch_event, catch_event_new, "event TLS diagnostic")

EDGE.write_text(edge, encoding="utf-8")

erp = ERP.read_text(encoding="utf-8")
erp = replace_once(
    erp,
    '''    } else if (r.status === 'processing' && r.retryable) {\n      setMessage('A transmissão ficou sem confirmação conclusiva. O XML e a chave foram preservados; use “Tentar novamente” sem duplicar a numeração.');\n''',
    '''    } else if (['processing', 'transmission_error'].includes(String(r.status)) && r.retryable) {\n      setMessage(r.status === 'transmission_error'\n        ? `Falha de comunicação com a SEFAZ${r.error_code ? ` (${String(r.error_code)})` : ''}. O XML assinado e a chave foram preservados; use “Tentar novamente” sem gerar outra numeração.`\n        : 'A transmissão ficou sem confirmação conclusiva. O XML e a chave foram preservados; use “Tentar novamente” sem duplicar a numeração.');\n''',
    "ERP transmission error message",
)
erp = replace_once(
    erp,
    "      const retryable = isNfce&&['draft', 'rejected', 'processing'].includes(status);",
    "      const retryable = isNfce&&['draft', 'rejected', 'processing', 'transmission_error'].includes(status);",
    "ERP transmission_error retry button",
)
erp = replace_once(
    erp,
    "<td><span className={`erp-pill ${status === 'rejected' ? 'danger' : ''}`}>{status}</span></td>",
    "<td><span className={`erp-pill ${['rejected', 'transmission_error'].includes(status) ? 'danger' : ''}`}>{status}</span></td>",
    "ERP transmission_error status style",
)
ERP.write_text(erp, encoding="utf-8")

print("SEFAZ TLS trust v079 patch applied")
