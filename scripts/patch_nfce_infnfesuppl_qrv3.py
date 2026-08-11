from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/thorfiscal-authorize/index.ts"

text = EDGE.read_text(encoding="utf-8")

old_func = '''function insertQrV3(signedXml: string, uf: string, homologation: boolean, tpAmb: number, accessKey: string) {
  const env = homologation ? "homologacao" : "producao";
  const qrBase = getNFCeQRCodeUrl(uf, env as any);
  const consulta = getNFCeConsultaUrl(uf, env as any);
  const qr = `${qrBase}${qrBase.includes("?") ? "&" : "?"}p=${accessKey}|3|${tpAmb}`;
  const supl = `<infNFeSupl><qrCode><![CDATA[${qr}]]></qrCode><urlChave>${consulta}</urlChave></infNFeSupl>`;
  return { xml: signedXml.replace("</NFe>", `${supl}</NFe>`), qr };
}
'''

new_func = '''function insertQrV3(signedXml: string, uf: string, homologation: boolean, accessKey: string) {
  const env = homologation ? "homologacao" : "producao";
  const qrBase = getNFCeQRCodeUrl(uf, env as any);
  const consulta = getNFCeConsultaUrl(uf, env as any);

  // NT 2025.001 - QR-Code v3, emissão on-line (tpEmis=1):
  // <chave_acesso>|3|  -- sem CSC e sem tpAmb no conteúdo do QR-Code v3.
  const qr = `${qrBase}${qrBase.includes("?") ? "&" : "?"}p=${accessKey}|3|`;
  const supl = `<infNFeSupl><qrCode><![CDATA[${qr}]]></qrCode><urlChave>${consulta}</urlChave></infNFeSupl>`;

  // O schema TNFe exige a sequência: infNFe, infNFeSupl (opcional), Signature.
  // O signer adiciona Signature após infNFe; portanto inserimos o suplemento imediatamente
  // antes da assinatura, sem alterar o conteúdo de infNFe que já foi assinado.
  const baseXml = signedXml.replace(/<infNFeSupl\\b[\\s\\S]*?<\\/infNFeSupl>/i, "");
  const signature = /<(?:\\w+:)?Signature\\b/.exec(baseXml);
  if (!signature || signature.index === undefined) throw new Error("nfce_signature_not_found_for_supplement");

  return {
    xml: `${baseXml.slice(0, signature.index)}${supl}${baseXml.slice(signature.index)}`,
    qr,
  };
}
'''

old_call = 'const withQr = insertQrV3(signedBase, built.uf, built.homologation, built.environment, accessKey);'
new_call = 'const withQr = insertQrV3(signedBase, built.uf, built.homologation, accessKey);'

if old_func not in text:
    raise SystemExit("insertQrV3 old implementation not found exactly once")
if text.count(old_func) != 1:
    raise SystemExit(f"insertQrV3 old implementation count={text.count(old_func)}")
if text.count(old_call) != 1:
    raise SystemExit(f"insertQrV3 call count={text.count(old_call)}")

text = text.replace(old_func, new_func, 1).replace(old_call, new_call, 1)

assert '|3|${tpAmb}' not in text
assert 'signedXml.replace("</NFe>"' not in text
assert 'p=${accessKey}|3|' in text
assert 'baseXml.slice(0, signature.index)' in text

EDGE.write_text(text, encoding="utf-8")
print("Patched NFC-e infNFeSupl order and QR-Code v3 online format.")
