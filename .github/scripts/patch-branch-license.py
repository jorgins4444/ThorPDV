from pathlib import Path


def replace(path, old, new, count=1):
    p=Path(path); s=p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'marker not found in {path}: {old[:120]}')
    s=s.replace(old,new,count)
    p.write_text(s,encoding='utf-8')

# ThorControl modules and defaults.
p='src/app/control/control-client.tsx'
replace(p,"['administration','Administrativo','Empresas, filiais e configurações'],['integrations'","['administration','Administrativo','Empresa, Matriz e configurações'],['branches','Lojas / Filiais','Libera unidades adicionais além da Matriz'],['integrations'")
replace(p,"const allModules=()=>Object.fromEntries(MODULES.map(([k])=>[k,true])) as Record<string,boolean>;","const allModules=()=>Object.fromEntries(MODULES.map(([k])=>[k,k==='branches'?false:true])) as Record<string,boolean>;")
replace(p,"if(!r.ok){setMessage(text(r.error||'Falha ao atualizar licença.'));return}","if(!r.ok){const code=text(r.error||'Falha ao atualizar licença.');setMessage(code==='branch_limit_below_current_usage'?`Não é possível reduzir a licença abaixo das ${num(r.branches_count)} unidade(s) já cadastradas.`:code);return}")
replace(p,"<div className=\"control-plan\"><div><strong>ThorPDV adicional</strong><span>por terminal acima de {num(pricing.included_pdv_terminals)||1} incluído(s)</span></div><b>{money(pricing.extra_pdv_terminal_price)}<small>/mês</small></b></div>","<div className=\"control-plan\"><div><strong>ThorPDV adicional</strong><span>por terminal acima de {num(pricing.included_pdv_terminals)||1} incluído(s)</span></div><b>{money(pricing.extra_pdv_terminal_price)}<small>/mês</small></b></div><div className=\"control-plan\"><div><strong>Loja / Filial adicional</strong><span>Matriz incluída; cobrança por unidade acima de {num(pricing.included_branches)||1}</span></div><b>{money(pricing.extra_branch_price)}<small>/mês</small></b></div>")
replace(p,"<label>Valor ThorPDV adicional<input name=\"extra_pdv_terminal_price\" type=\"number\" min=\"0\" step=\"0.01\" defaultValue={num(pricing.extra_pdv_terminal_price)}/></label>","<label>Valor ThorPDV adicional<input name=\"extra_pdv_terminal_price\" type=\"number\" min=\"0\" step=\"0.01\" defaultValue={num(pricing.extra_pdv_terminal_price)}/></label><label>Lojas incluídas na base<input name=\"included_branches\" type=\"number\" min=\"1\" defaultValue={num(pricing.included_branches)||1}/></label><label>Valor por filial adicional<input name=\"extra_branch_price\" type=\"number\" min=\"0\" step=\"0.01\" defaultValue={num(pricing.extra_branch_price)}/></label>")
replace(p,"<i>+</i><span>PDVs acima de {num(pricing.included_pdv_terminals)||1}</span><strong>{money(pricing.extra_pdv_terminal_price)} cada</strong></div>","<i>+</i><span>PDVs acima de {num(pricing.included_pdv_terminals)||1}</span><strong>{money(pricing.extra_pdv_terminal_price)} cada</strong><i>+</i><span>Filiais acima de {num(pricing.included_branches)||1} loja(s) incluída(s)</span><strong>{money(pricing.extra_branch_price)} cada</strong></div>")
replace(p,"<label>ThorPDV<input name=\"pdv_terminal_limit\" type=\"number\" min=\"0\" defaultValue={num(editing.pdv_terminal_limit)}/></label><label>Validade", "<label>ThorPDV<input name=\"pdv_terminal_limit\" type=\"number\" min=\"0\" defaultValue={num(editing.pdv_terminal_limit)}/></label><label>Total de lojas / unidades<input name=\"branch_limit\" type=\"number\" min=\"1\" defaultValue={Math.max(num(editing.branch_limit),1)}/><small>Inclui a Matriz. Ex.: 2 = Matriz + 1 filial.</small></label><label>Validade")
replace(p,"<th>Gestão</th><th>ThorPDV</th><th>Mensalidade</th>","<th>Gestão</th><th>ThorPDV</th><th>Lojas</th><th>Mensalidade</th>")
replace(p,"<tr><td colSpan={8} className=\"empty\">", "<tr><td colSpan={9} className=\"empty\">")
replace(p,"<td><strong>{num(c.pdv_devices)} / {num(c.pdv_terminal_limit)}</strong><small>ativos / licença</small></td><td><strong>{money(c.monthly_amount)}", "<td><strong>{num(c.pdv_devices)} / {num(c.pdv_terminal_limit)}</strong><small>ativos / licença</small></td><td><strong>{num(c.branch_count)} / {Math.max(num(c.branch_limit),1)}</strong><small>unidades / licença</small></td><td><strong>{money(c.monthly_amount)}")

# Customer provisioning.
p='src/app/control/customer-provision-modal.tsx'
replace(p,"['administration','Administrativo','Empresas, filiais e configurações'],['integrations'","['administration','Administrativo','Empresa, Matriz e configurações'],['branches','Lojas / Filiais','Libera unidades adicionais além da Matriz'],['integrations'")
replace(p,"admin_email:'',contact:'',responsible:'',license_status:'trial',management_user_limit:'5',pdv_terminal_limit:'1',expires_at:'',notes:'',","admin_email:'',contact:'',responsible:'',license_status:'trial',management_user_limit:'5',pdv_terminal_limit:'1',branch_limit:'1',expires_at:'',notes:'',")
replace(p,"useState({...blank,management_user_limit:String(num(pricing.included_management_users)||5),pdv_terminal_limit:String(num(pricing.included_pdv_terminals)||1)});", "useState({...blank,management_user_limit:String(num(pricing.included_management_users)||5),pdv_terminal_limit:String(num(pricing.included_pdv_terminals)||1),branch_limit:String(num(pricing.included_branches)||1)});")
replace(p,"Object.fromEntries(MODULES.map(([k])=>[k,true]))", "Object.fromEntries(MODULES.map(([k])=>[k,k==='branches'?false:true]))")
replace(p,"const monthly=useMemo(()=>{const base=num(pricing.base_erp_price),iu=num(pricing.included_management_users)||5,ip=num(pricing.included_pdv_terminals)||1;return base+Math.max(Number(form.management_user_limit||0)-iu,0)*num(pricing.extra_management_user_price)+Math.max(Number(form.pdv_terminal_limit||0)-ip,0)*num(pricing.extra_pdv_terminal_price)},[form.management_user_limit,form.pdv_terminal_limit,pricing]);", "const monthly=useMemo(()=>{const base=num(pricing.base_erp_price),iu=num(pricing.included_management_users)||5,ip=num(pricing.included_pdv_terminals)||1,ib=num(pricing.included_branches)||1;const branchTotal=modules.branches?Math.max(Number(form.branch_limit||1),1):1;return base+Math.max(Number(form.management_user_limit||0)-iu,0)*num(pricing.extra_management_user_price)+Math.max(Number(form.pdv_terminal_limit||0)-ip,0)*num(pricing.extra_pdv_terminal_price)+Math.max(branchTotal-ib,0)*num(pricing.extra_branch_price)},[form.management_user_limit,form.pdv_terminal_limit,form.branch_limit,modules.branches,pricing]);")
replace(p,"{input('pdv_terminal_limit','Terminais ThorPDV',{type:'number',min:0})}{input('expires_at'", "{input('pdv_terminal_limit','Terminais ThorPDV',{type:'number',min:0})}<label>Total de lojas / unidades<input name=\"branch_limit\" type=\"number\" min=\"1\" value={form.branch_limit} onChange={e=>{set('branch_limit',e.target.value);if(Number(e.target.value)>1)setModules(m=>({...m,branches:true}))}}/><small>Inclui a Matriz. 2 = Matriz + 1 filial.</small></label>{input('expires_at'")

# Gestão license result.
p='src/app/dashboard/[...slug]/license-actions.ts'
replace(p,"pdv_terminal_limit:Number(r.pdv_terminal_limit??0),expires_at", "pdv_terminal_limit:Number(r.pdv_terminal_limit??0),branch_limit:Number(r.branch_limit??1),branches_count:Number(r.branches_count??1),branch_remaining:Number(r.branch_remaining??0),monthly_amount:Number(r.monthly_amount??0),expires_at")

# Sidebar: licensed branch module.
p='src/app/dashboard/[...slug]/advanced-shell.tsx'
replace(p,"[['Matriz','/dashboard/administrativo/empresas'],['Caixas e PDVs'", "[['Matriz','/dashboard/administrativo/empresas'],['Lojas / Filiais','/dashboard/administrativo/filiais'],['Caixas e PDVs'")
replace(p,"function itemModule(label:string,href:string){if(href.includes('/estoque/producao'))", "function itemModule(label:string,href:string){if(href.includes('/administrativo/filiais'))return 'branches';if(href.includes('/estoque/producao'))")

# Page route/workspace.
p='src/app/dashboard/[...slug]/page.tsx'
replace(p,"import './branch-config.css';", "import './branch-config.css';\nimport './branches-workspace.css';")
replace(p,"import { BranchConfigWorkspace } from './branch-config-workspace';", "import { BranchConfigWorkspace } from './branch-config-workspace';\nimport { BranchesWorkspace } from './branches-workspace';\nimport { erpLicenseGet } from './license-actions';")
replace(p,"'administrativo/empresas': 'companies', 'administrativo/pdvs'", "'administrativo/empresas': 'companies', 'administrativo/filiais': 'branches', 'administrativo/pdvs'")
marker="  if (slug === 'configuracoes') return <AdvancedShell title=\"Configurações da Operação\""
insert="  if (slug === 'administrativo/filiais') {\n    const license=await erpLicenseGet();\n    return <AdvancedShell title=\"Lojas / Filiais\" subtitle=\"Gerencie unidades adicionais conforme o limite contratado no ThorControl. A Matriz permanece como estabelecimento principal.\" activePath=\"/dashboard/administrativo/filiais\"><BranchesWorkspace initialBranches={branches.data} license={license as unknown as Record<string,unknown>}/></AdvancedShell>;\n  }\n"
s=Path(p).read_text(encoding='utf-8')
if insert not in s:
    if marker not in s: raise SystemExit('page route marker not found')
    s=s.replace(marker,insert+marker,1)
    Path(p).write_text(s,encoding='utf-8')

# Assertions.
checks={
 'src/app/control/control-client.tsx':['Lojas / Filiais','branch_limit','extra_branch_price','branch_count'],
 'src/app/control/customer-provision-modal.tsx':['branch_limit','extra_branch_price',"branches:true"],
 'src/app/dashboard/[...slug]/advanced-shell.tsx':['/dashboard/administrativo/filiais',"return 'branches'"],
 'src/app/dashboard/[...slug]/page.tsx':['BranchesWorkspace','administrativo/filiais','erpLicenseGet'],
 'src/app/dashboard/[...slug]/license-actions.ts':['branch_limit','branches_count','branch_remaining'],
}
for f,markers in checks.items():
    s=Path(f).read_text(encoding='utf-8')
    for m in markers:
        if m not in s: raise SystemExit(f'{f}: missing {m}')
print('branch license UI patch OK')
