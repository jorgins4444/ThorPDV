from pathlib import Path

path=Path("src/app/dashboard/[...slug]/nfe-emission-workspace.tsx")
text=path.read_text(encoding="utf-8")

def rep(old,new):
    global text
    if old not in text:
        raise SystemExit(f"pattern not found:\n{old[:220]}")
    text=text.replace(old,new)

rep("import { useMemo, useState } from 'react';", "import { useEffect, useMemo, useState } from 'react';")
rep("import { fiscalPrepareV2, nfeManualDraftCreate } from './fiscal-config-actions';", "import { fiscalCfopRulesGet, fiscalPrepareV2, nfeManualDraftCreate } from './fiscal-config-actions';\nimport { cfopPrefixForScope, destinationScope, resolveCfopClient, scopeLabel } from './nfe-cfop-engine';")
rep("  cfop: string;\n  origin: string;", "  cfop: string;\n  cfop_default: string;\n  cfop_manual: boolean;\n  cfop_reason: string;\n  origin: string;")
rep("    cfop: digits(product.cfop_default || fiscal.cfop || fiscal.cfop_default),\n    origin:", "    cfop: digits(product.cfop_default || fiscal.cfop || fiscal.cfop_default),\n    cfop_default: digits(product.cfop_default || fiscal.cfop || fiscal.cfop_default),\n    cfop_manual: false,\n    cfop_reason: 'Aguardando identificação do destino da operação.',\n    origin:")
rep("    ncm: '', cest: '', cfop: '', origin: '0', icms_code: '', pis_cst: '', cofins_cst: '',", "    ncm: '', cest: '', cfop: '', cfop_default: '', cfop_manual: false, cfop_reason: 'Aguardando identificação do destino da operação.', origin: '0', icms_code: '', pis_cst: '', cofins_cst: '',")
rep("  const [manualSuccess, setManualSuccess] = useState<Row | null>(null);", "  const [manualSuccess, setManualSuccess] = useState<Row | null>(null);\n  const [cfopRules, setCfopRules] = useState<Row[]>([]);")
rep("  const nfeSeries = series.filter((row) => row.document_type === 'nfe' && row.active !== false);", "  const nfeSeries = series.filter((row) => row.document_type === 'nfe' && row.active !== false);\n  const cfops = (Array.isArray(settings.cfops) ? settings.cfops : []) as Row[];\n  const emitterState = txt(issuer.state).toUpperCase();\n  const currentScope = destinationScope(emitterState, recipient.state);\n  const currentPrefix = cfopPrefixForScope(currentScope);\n  const cfopOptions = cfops.filter((row) => row.active !== false && ['5','6','7'].includes(txt(row.code).slice(0,1)) && (!currentPrefix || txt(row.code).startsWith(currentPrefix)));")
rep("  const documentKey = `${docs.length}-${txt(docs[0]?.id)}`;", "  const documentKey = `${docs.length}-${txt(docs[0]?.id)}`;\n\n  useEffect(() => {\n    let mounted = true;\n    void fiscalCfopRulesGet().then((result) => {\n      if (mounted && result.ok && Array.isArray(result.data)) setCfopRules(result.data as Row[]);\n    });\n    return () => { mounted = false; };\n  }, []);\n\n  useEffect(() => {\n    setItems((current) => current.map((item) => {\n      if (item.cfop_manual) return item;\n      const resolution = resolveCfopClient({\n        rules: cfopRules, cfops, productCfop: item.cfop_default, purpose, presence, emitterState, recipientState: recipient.state, consumerFinal, indicatorIe: recipient.indicator_ie,\n      });\n      return { ...item, cfop: resolution.code || item.cfop_default, cfop_reason: resolution.reason };\n    }));\n  }, [purpose, presence, consumerFinal, recipient.state, recipient.indicator_ie, emitterState, cfopRules, cfops, items.length]);")
rep("  function updateItem(key: string, field: keyof ManualItem, value: string) {\n    setItems((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));\n  }", "  function updateItem(key: string, field: keyof ManualItem, value: string) {\n    setItems((current) => current.map((item) => item.key === key ? { ...item, [field]: value, ...(field === 'cfop' ? { cfop_manual: true, cfop_reason: 'CFOP alterado manualmente a partir do catálogo geral.' } : {}) } : item));\n  }\n\n  function resetItemCfop(key: string) {\n    setItems((current) => current.map((item) => {\n      if (item.key !== key) return item;\n      const resolution = resolveCfopClient({ rules: cfopRules, cfops, productCfop: item.cfop_default, purpose, presence, emitterState, recipientState: recipient.state, consumerFinal, indicatorIe: recipient.indicator_ie });\n      return { ...item, cfop_manual: false, cfop: resolution.code || item.cfop_default, cfop_reason: resolution.reason };\n    }));\n  }")
rep("<label>Presença do comprador<select value={presence} onChange={(e) => setPresence(e.target.value)}><option value=\"0\">Não se aplica</option><option value=\"1\">Operação presencial</option><option value=\"2\">Internet</option><option value=\"3\">Teleatendimento</option><option value=\"9\">Outros</option></select></label>", "<label>Presença do comprador<select value={presence} onChange={(e) => setPresence(e.target.value)}><option value=\"0\">Não se aplica</option><option value=\"1\">Operação presencial</option><option value=\"2\">Não presencial · Internet</option><option value=\"3\">Não presencial · Teleatendimento</option><option value=\"5\">Presencial · fora do estabelecimento</option><option value=\"9\">Não presencial · outros</option></select></label>")
old="<label>CFOP<input value={item.cfop} onChange={(e) => updateItem(item.key, 'cfop', e.target.value)} /></label>"
new="<label>CFOP<select value={item.cfop} onChange={(e) => updateItem(item.key, 'cfop', e.target.value)}><option value=\"\">Selecione...</option>{cfopOptions.map((row) => <option key={txt(row.id)} value={txt(row.code)}>{txt(row.code)} · {txt(row.name)}</option>)}</select><small>{item.cfop_reason || `Destino: ${scopeLabel(currentScope)}`}</small>{item.cfop_manual && <button type=\"button\" className=\"nfe-cfop-auto-reset\" onClick={() => resetItemCfop(item.key)}>Usar automático</button>}</label>"
if text.count(old) != 2:
    raise SystemExit(f"expected 2 CFOP inputs, found {text.count(old)}")
text=text.replace(old,new)
rep("<div className=\"nfe-note\">As alíquotas e demais campos detalhados do perfil fiscal continuam preservados no cadastro do produto. Esta etapa deixa visíveis os classificadores principais da operação.</div>", "<div className=\"nfe-note\"><b>CFOP automático:</b> o Thor cruza finalidade, presença, consumidor final e UF do destinatário com as regras cadastradas em Fiscal → CFOPs. Se não houver regra, tenta manter o CFOP padrão do produto ou localizar o equivalente 5.xxx/6.xxx/7.xxx no catálogo geral. A troca manual continua disponível por item.</div>")
path.write_text(text,encoding="utf-8")

css=Path("src/app/dashboard/[...slug]/nfe-emission.css")
style=css.read_text(encoding="utf-8")
addition="""
.nfe-cfop-auto-reset{margin-top:6px;border:0;background:transparent;color:#5b35d5;font-size:11px;font-weight:800;padding:0;cursor:pointer;text-align:left}.nfe-cfop-auto-reset:hover{text-decoration:underline}.nfe-item-card label>small{display:block;margin-top:5px;color:#667085;font-size:11px;line-height:1.35}.nfe-item-card label select+small{min-height:30px}
"""
if ".nfe-cfop-auto-reset" not in style:
    css.write_text(style+addition,encoding="utf-8")
