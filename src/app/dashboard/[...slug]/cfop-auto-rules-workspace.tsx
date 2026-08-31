'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { fiscalCfopRuleSave, fiscalCfopRulesGet } from './fiscal-config-actions';

type Row=Record<string,unknown>;
const txt=(v:unknown)=>v==null?'':String(v);
const bool=(v:unknown)=>Boolean(v);
const purposeLabels:Record<string,string>={'':'Qualquer','1':'Normal','2':'Complementar','3':'Ajuste','4':'Devolução / Retorno'};
const presenceLabels:Record<string,string>={'':'Qualquer','0':'Não se aplica','1':'Presencial','2':'Não presencial · Internet','3':'Não presencial · Teleatendimento','5':'Presencial fora do estabelecimento','9':'Não presencial · Outros'};
const scopeLabels:Record<string,string>={internal:'Mesma UF do emitente',interstate:'Outra UF',foreign:'Exterior'};
const ieLabels:Record<string,string>={'':'Qualquer','1':'Contribuinte ICMS','2':'Contribuinte isento','9':'Não contribuinte'};

export function CfopAutoRulesWorkspace({cfops}:{cfops:Row[]}){
  const [rules,setRules]=useState<Row[]>([]);
  const [edit,setEdit]=useState<Row|null>(null);
  const [name,setName]=useState('Venda padrão');
  const [purpose,setPurpose]=useState('1');
  const [presence,setPresence]=useState('');
  const [scope,setScope]=useState('internal');
  const [consumerFinal,setConsumerFinal]=useState('any');
  const [indicatorIe,setIndicatorIe]=useState('');
  const [cfopId,setCfopId]=useState('');
  const [priority,setPriority]=useState('100');
  const [active,setActive]=useState(true);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  const activeCfops=useMemo(()=>cfops.filter(row=>row.active!==false&&['5','6','7'].includes(txt(row.code).slice(0,1))),[cfops]);
  const scopeCfops=useMemo(()=>activeCfops.filter(row=>txt(row.code).startsWith(scope==='internal'?'5':scope==='interstate'?'6':'7')),[activeCfops,scope]);

  async function load(){const r=await fiscalCfopRulesGet();if(r.ok&&Array.isArray(r.data))setRules(r.data as Row[]);}
  useEffect(()=>{void load();},[]);
  useEffect(()=>{if(cfopId&&!scopeCfops.some(row=>txt(row.id)===cfopId))setCfopId('');},[scope,cfopId,scopeCfops]);

  function reset(){setEdit(null);setName('Venda padrão');setPurpose('1');setPresence('');setScope('internal');setConsumerFinal('any');setIndicatorIe('');setCfopId('');setPriority('100');setActive(true);}
  function editRule(row:Row){setEdit(row);setName(txt(row.name));setPurpose(txt(row.purpose));setPresence(txt(row.presence));setScope(txt(row.destination_scope)||'internal');setConsumerFinal(row.consumer_final===true?'true':row.consumer_final===false?'false':'any');setIndicatorIe(txt(row.indicator_ie));setCfopId(txt(row.cfop_id));setPriority(txt(row.priority)||'100');setActive(row.active!==false);}
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setMessage('');const r=await fiscalCfopRuleSave({id:edit?.id??null,name,purpose:purpose||null,presence:presence||null,destination_scope:scope,consumer_final:consumerFinal,indicator_ie:indicatorIe||null,cfop_id:cfopId,priority:Number(priority||100),active});setBusy(false);if(r.ok){reset();await load();setMessage('Regra automática de CFOP salva.');}else{const labels:Record<string,string>={invalid_rule_name:'Informe um nome para a regra.',invalid_cfop:'Selecione um CFOP ativo.',cfop_scope_mismatch:'O CFOP não corresponde ao tipo de destino escolhido.',invalid_destination_scope:'Destino inválido.',invalid_priority:'A prioridade deve ficar entre 1 e 999.'};setMessage(labels[txt(r.error)]||txt(r.error)||'Não foi possível salvar a regra.');}}

  return <section className="erp-module-card fiscal-config-card">
    <div className="fiscal-section-head"><div><h2>Automação de CFOP na NF-e</h2><p>Defina qual CFOP o ThorGestão deve sugerir conforme finalidade, presença do comprador e destino da operação. Regras mais específicas e com menor prioridade numérica são avaliadas primeiro.</p></div><span className="fiscal-config-tag">NF-e 55</span></div>
    {message&&<div className="nfe-global-message">{message}</div>}
    <form className="fiscal-config-form" onSubmit={save}>
      <label>Nome da regra<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Venda presencial dentro do estado"/></label>
      <label>Destino<select value={scope} onChange={e=>setScope(e.target.value)}><option value="internal">Mesma UF</option><option value="interstate">Outra UF</option><option value="foreign">Exterior</option></select></label>
      <label>Finalidade<select value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="">Qualquer</option><option value="1">Normal</option><option value="2">Complementar</option><option value="3">Ajuste</option><option value="4">Devolução / Retorno</option></select></label>
      <label>Presença<select value={presence} onChange={e=>setPresence(e.target.value)}><option value="">Qualquer</option><option value="0">Não se aplica</option><option value="1">Presencial</option><option value="2">Internet</option><option value="3">Teleatendimento</option><option value="5">Presencial fora do estabelecimento</option><option value="9">Não presencial · outros</option></select></label>
      <label>Consumidor final<select value={consumerFinal} onChange={e=>setConsumerFinal(e.target.value)}><option value="any">Qualquer</option><option value="true">Sim</option><option value="false">Não</option></select></label>
      <label>Indicador IE<select value={indicatorIe} onChange={e=>setIndicatorIe(e.target.value)}><option value="">Qualquer</option><option value="1">Contribuinte ICMS</option><option value="2">Isento</option><option value="9">Não contribuinte</option></select></label>
      <label className="wide">CFOP da configuração geral<select required value={cfopId} onChange={e=>setCfopId(e.target.value)}><option value="">Selecione...</option>{scopeCfops.map(row=><option key={txt(row.id)} value={txt(row.id)}>{txt(row.code)} · {txt(row.name)}</option>)}</select><small>A lista vem do cadastro geral de CFOPs e é filtrada automaticamente: 5.xxx mesma UF, 6.xxx outra UF, 7.xxx exterior.</small></label>
      <label>Prioridade<input type="number" min="1" max="999" value={priority} onChange={e=>setPriority(e.target.value)}/><small>1 = maior prioridade</small></label>
      <label className="fiscal-check"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Regra ativa</label>
      <div className="fiscal-config-actions wide"><button className="erp-primary" disabled={busy}>{busy?'Salvando...':edit?'Salvar alterações':'Adicionar regra'}</button>{edit&&<button type="button" className="erp-ghost" onClick={reset}>Cancelar</button>}</div>
    </form>
    <div className="erp-table-scroll"><table className="erp-data-table fiscal-config-table"><thead><tr><th>Prioridade</th><th>Regra</th><th>Destino</th><th>Finalidade</th><th>Presença</th><th>Consumidor</th><th>IE</th><th>CFOP</th><th>Status</th><th>Ação</th></tr></thead><tbody>{rules.length===0?<tr><td colSpan={10} className="erp-empty">Nenhuma regra automática cadastrada. Sem regra, o Thor usa o CFOP padrão do produto quando compatível com a UF ou procura o equivalente 5/6/7 no catálogo geral.</td></tr>:rules.map(row=><tr key={txt(row.id)}><td>{txt(row.priority)}</td><td><b>{txt(row.name)}</b></td><td>{scopeLabels[txt(row.destination_scope)]||txt(row.destination_scope)}</td><td>{purposeLabels[txt(row.purpose)]||'Qualquer'}</td><td>{presenceLabels[txt(row.presence)]||'Qualquer'}</td><td>{row.consumer_final===true?'Sim':row.consumer_final===false?'Não':'Qualquer'}</td><td>{ieLabels[txt(row.indicator_ie)]||'Qualquer'}</td><td><b>{txt(row.cfop_code)}</b><small>{txt(row.cfop_name)}</small></td><td><span className={`erp-pill ${row.active===false?'danger':''}`}>{row.active===false?'Inativa':'Ativa'}</span></td><td><button type="button" className="erp-row-action" onClick={()=>editRule(row)}>Editar</button></td></tr>)}</tbody></table></div>
  </section>;
}
