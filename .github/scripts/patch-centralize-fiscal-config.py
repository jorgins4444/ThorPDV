from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
path = root / 'src/app/dashboard/[...slug]/branch-config-workspace.tsx'
text = path.read_text(encoding='utf-8')

if "import Link from 'next/link';" not in text:
    text = text.replace("'use client';\n\n", "'use client';\n\nimport Link from 'next/link';\n")

text = text.replace(
    "const integrations=rows(data.integrations),smart=rows(data.smartpos_terminals),windows=rows(data.windows_terminals),groups=rows(data.tax_groups),rates=rows(data.delivery_rates),history=rows(data.history),fiscalSecrets=obj(data.fiscal_secrets);",
    "const integrations=rows(data.integrations),smart=rows(data.smartpos_terminals),windows=rows(data.windows_terminals),groups=rows(data.tax_groups),rates=rows(data.delivery_rates),history=rows(data.history);"
)

text = text.replace(
    '<p>Fiscal, terminais, parâmetros do PDV e adquirentes SmartPOS por estabelecimento.</p>',
    '<p>Dados do estabelecimento, terminais, parâmetros do PDV e integrações. Certificado, CSC, ambiente, séries e transmissão ficam centralizados no módulo Fiscal.</p>'
)

text = text.replace(
    '<div className="branch-section-head"><h3>Dados gerais</h3><button className="erp-primary">Gravar</button></div>',
    '<div className="branch-section-head"><div><h3>Dados gerais e fiscais do estabelecimento</h3><p>CNPJ, IE, CRT e endereço identificam a filial emitente e são usados pelo ThorFiscal no XML.</p></div><button className="erp-primary">Gravar</button></div>'
)
text = text.replace('CPF/CNPJ<input name="cnpj"', 'CNPJ<input name="cnpj"')

pattern = re.compile(r"\n    \{active==='fiscal'&&<form className=\"branch-panel\"[\s\S]*?\n    </form>\}\n\n    \{active==='parameters'", re.M)
replacement = r'''
    {active==='fiscal'&&<div className="branch-panel">
      <div className="branch-section-head"><div><h3>Fiscal da filial</h3><p>A configuração fiscal operacional foi centralizada para evitar certificado, CSC ou ambiente divergentes entre telas.</p></div></div>
      <div className="branch-info-strip"><span><b>CNPJ</b>{text(branch.cnpj)||'Não informado'}</span><span><b>Inscrição Estadual</b>{text(settings.state_registration)||'Não informada'}</span><span><b>CRT</b>{text(settings.crt)||'Não definido'}</span><span><b>Endereço fiscal</b>{text(branch.street)&&text(branch.number)&&text(branch.district)&&text(branch.postal_code)&&text(branch.ibge_city_code)?'Completo':'Incompleto'}</span></div>
      <div className="branch-fiscal-central-card">
        <div><strong>Configuração fiscal centralizada</strong><p>Certificado digital A1, ambiente Homologação/Produção, CSC, séries, numeração, vínculo Caixa → Série, CFOP e DANFE são administrados somente no módulo Fiscal.</p></div>
        <Link className="erp-primary" href="/dashboard/fiscal">Abrir módulo Fiscal</Link>
      </div>
      <div className="branch-checks"><div className={text(settings.state_registration)?'ok':'warn'}>Inscrição Estadual do estabelecimento</div><div className={text(settings.crt)?'ok':'warn'}>CRT definido</div><div className={text(branch.street)&&text(branch.number)&&text(branch.district)&&text(branch.postal_code)&&text(branch.ibge_city_code)?'ok':'warn'}>Endereço fiscal completo</div></div>
      <p className="branch-fiscal-central-note">Para alterar certificado, CSC, ambiente, série, numeração ou DANFE, use Fiscal. Esta tela mostra apenas a prontidão cadastral da filial.</p>
    </div>}

    {active==='parameters' '''

text2, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'Fiscal block replacement failed: {count}')
text = text2

path.write_text(text, encoding='utf-8')

page = root / 'src/app/dashboard/[...slug]/page.tsx'
p = page.read_text(encoding='utf-8')
p = p.replace(
    'subtitle="Centralize parâmetros gerais, terminais, fiscal, tributos, entrega, SmartPOS, integrações e histórico por filial."',
    'subtitle="Centralize dados do estabelecimento, terminais, tributos, entrega, SmartPOS, integrações e histórico. A operação fiscal fica no módulo Fiscal."'
)
page.write_text(p, encoding='utf-8')

css = root / 'src/app/dashboard/[...slug]/branch-config.css'
c = css.read_text(encoding='utf-8')
marker = '.branch-fiscal-central-card'
if marker not in c:
    c += '''\n.branch-fiscal-central-card{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px;border:1px solid #dbe5e3;border-radius:14px;background:#f8fbfa}.branch-fiscal-central-card strong{display:block;color:#0f172a;font-size:15px}.branch-fiscal-central-card p{margin:5px 0 0;color:#64748b;max-width:760px}.branch-fiscal-central-card .erp-primary{white-space:nowrap;text-decoration:none}.branch-fiscal-central-note{margin:0;padding:10px 12px;border-radius:10px;background:#f8fafc;color:#64748b;font-size:12px}@media(max-width:760px){.branch-fiscal-central-card{align-items:stretch;flex-direction:column}.branch-fiscal-central-card .erp-primary{text-align:center}}\n'''
css.write_text(c, encoding='utf-8')
