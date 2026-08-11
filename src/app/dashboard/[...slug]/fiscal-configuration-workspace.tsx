'use client';

import { FormEvent, useMemo, useState } from 'react';
import { fiscalCfopSave, fiscalConfigGet, fiscalPosSeriesSave, fiscalSeriesSave, fiscalSettingsSave } from './fiscal-config-actions';

type Row=Record<string,unknown>;
type Props={initialSettings:Row;onConfigChange?:(settings:Row)=>void};
const bool=(v:unknown)=>Boolean(v);
const txt=(v:unknown)=>v==null?'':String(v);
const number=(v:unknown,fallback=0)=>{const n=Number(v);return Number.isFinite(n)?n:fallback};
const modelLabel=(v:unknown)=>String(v)==='nfce'?'NFC-e':'NF-e';
const orderLabels:Record<string,string>={alphabetical:'Alfabética',launch:'Lançamento',internal_code:'Código interno'};
const errorLabels:Record<string,string>={
  invalid_csc_id:'Número de identificação (ID CSC) inválido.',invalid_danfe_decimal_places:'Casas decimais do DANFE inválidas.',invalid_danfe_product_lines:'Número de linhas do produto inválido.',invalid_danfe_item_order:'Ordenação do DANFE inválida.',
  invalid_fiscal_series:'A série fiscal deve estar entre 1 e 999.',invalid_last_fiscal_number:'Informe um último número de nota válido.',last_number_below_existing_document:'O último número informado é menor que uma nota já existente nesta série.',series_identity_locked_by_documents:'Não é possível alterar modelo/série porque já existem documentos emitidos.',series_in_use_by_cash_register:'Esta série está vinculada a um caixa em uso.',default_series_cannot_be_disabled:'A série padrão não pode ser desativada.',fiscal_series_already_exists:'Esta série já está cadastrada para este modelo.',
  cash_number_already_in_use:'Existe um caixa utilizando esta numeração.',fiscal_series_already_in_use:'Esta série fiscal já está em uso por outro caixa.',cash_or_series_already_in_use:'O número do caixa ou a série fiscal já está em uso.',cash_register_not_found:'Caixa/PDV não encontrado.',nfce_series_not_found:'Selecione uma série NFC-e ativa.',fiscal_series_required:'Selecione a série fiscal do caixa.',
  invalid_cfop_code:'O CFOP deve possuir exatamente 4 dígitos.',invalid_cfop_name:'Informe a descrição do CFOP.',cfop_already_exists:'Este CFOP já existe.',
};
const err=(v:unknown)=>errorLabels[String(v??'')]||String(v??'Não foi possível salvar.');

export function FiscalConfigurationWorkspace({initialSettings,onConfigChange}:Props){
  const [settings,setSettings]=useState<Row>(initialSettings);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState('');
  const [environment,setEnvironment]=useState(txt(initialSettings.environment)||'homologation');
  const [cscId,setCscId]=useState(txt(initialSettings.csc_id));
  const [cscToken,setCscToken]=useState('');
  const danfe=(initialSettings.danfe&&typeof initialSettings.danfe==='object'?initialSettings.danfe:{}) as Row;
  const [decimalPlaces,setDecimalPlaces]=useState(number(danfe.unit_decimal_places,2));
  const [productLines,setProductLines]=useState(number(danfe.product_name_lines,2));
  const [itemOrder,setItemOrder]=useState(txt(danfe.item_order)||'launch');
  const [nameFormat,setNameFormat]=useState(txt(danfe.product_name_format)||'{nome}');
  const [seriesEdit,setSeriesEdit]=useState<Row|null>(null);
  const [seriesModel,setSeriesModel]=useState<'nfe'|'nfce'>('nfce');
  const [seriesNumber,setSeriesNumber]=useState('1');
  const [seriesLabel,setSeriesLabel]=useState('');
  const [lastNumber,setLastNumber]=useState('0');
  const [seriesDefault,setSeriesDefault]=useState(false);
  const [seriesActive,setSeriesActive]=useState(true);
  const [cfopEdit,setCfopEdit]=useState<Row|null>(null);
  const [cfopCode,setCfopCode]=useState('');
  const [cfopName,setCfopName]=useState('');
  const [cfopActive,setCfopActive]=useState(true);
  const [cfopSearch,setCfopSearch]=useState('');
  const [posDrafts,setPosDrafts]=useState<Record<string,{cash_number:string;fiscal_series_id:string;in_use:boolean}>>(()=>makePosDrafts(initialSettings));

  const series=(Array.isArray(settings.series)?settings.series:[]) as Row[];
  const pos=(Array.isArray(settings.pos_registers)?settings.pos_registers:[]) as Row[];
  const cfops=(Array.isArray(settings.cfops)?settings.cfops:[]) as Row[];
  const nfceSeries=series.filter(s=>s.document_type==='nfce'&&s.active!==false);
  const filteredCfops=useMemo(()=>{const q=cfopSearch.trim().toLowerCase();return !q?cfops:cfops.filter(c=>txt(c.code).includes(q)||txt(c.name).toLowerCase().includes(q));},[cfops,cfopSearch]);

  function makeSettings(next:Row){setSettings(next);setEnvironment(txt(next.environment)||'homologation');setCscId(txt(next.csc_id));const d=(next.danfe&&typeof next.danfe==='object'?next.danfe:{}) as Row;setDecimalPlaces(number(d.unit_decimal_places,2));setProductLines(number(d.product_name_lines,2));setItemOrder(txt(d.item_order)||'launch');setNameFormat(txt(d.product_name_format)||'{nome}');setPosDrafts(makePosDrafts(next));onConfigChange?.(next);}
  async function refresh(success?:string){const r=await fiscalConfigGet();const next=(r.settings&&typeof r.settings==='object'?r.settings:null) as Row|null;if(r.ok&&next){makeSettings(next);if(success)setMessage(success)}else setMessage(err(r.error));}

  async function saveGeneral(e:FormEvent){e.preventDefault();setBusy('general');const r=await fiscalSettingsSave({environment,csc_id:cscId,csc_token:cscToken||undefined,unit_decimal_places:decimalPlaces,product_name_lines:productLines,item_order:itemOrder,product_name_format:nameFormat});setBusy('');if(r.ok){setCscToken('');await refresh('Configuração de NFC-e e DANFE salva.')}else setMessage(err(r.error));}
  async function clearToken(){if(!confirm('Remover o token CSC armazenado?'))return;setBusy('general');const r=await fiscalSettingsSave({environment,csc_id:cscId,clear_csc_token:true,unit_decimal_places:decimalPlaces,product_name_lines:productLines,item_order:itemOrder,product_name_format:nameFormat});setBusy('');if(r.ok)await refresh('Token CSC removido.');else setMessage(err(r.error));}

  function resetSeries(){setSeriesEdit(null);setSeriesModel('nfce');setSeriesNumber('1');setSeriesLabel('');setLastNumber('0');setSeriesDefault(false);setSeriesActive(true);}
  function editSeries(row:Row){setSeriesEdit(row);setSeriesModel(String(row.document_type)==='nfe'?'nfe':'nfce');setSeriesNumber(txt(row.series));setSeriesLabel(txt(row.label));setLastNumber(txt(row.last_number));setSeriesDefault(bool(row.is_default));setSeriesActive(row.active!==false);}
  async function saveSeries(e:FormEvent){e.preventDefault();setBusy('series');const r=await fiscalSeriesSave({id:seriesEdit?.id??null,document_type:seriesModel,series:Number(seriesNumber),label:seriesLabel,last_number:Number(lastNumber),is_default:seriesDefault,active:seriesActive});setBusy('');if(r.ok){resetSeries();await refresh('Série fiscal salva. O próximo número será '+String(r.next_number??'calculado automaticamente')+'.')}else setMessage(err(r.error)+(r.minimum?` Mínimo permitido: ${String(r.minimum)}.`:''));}

  function changePos(id:string,key:'cash_number'|'fiscal_series_id'|'in_use',value:string|boolean){setPosDrafts(current=>({...current,[id]:{...(current[id]??{cash_number:'',fiscal_series_id:'',in_use:false}),[key]:value}}));}
  async function savePos(row:Row){const id=txt(row.id);const draft=posDrafts[id];if(!draft)return;setBusy(`pos:${id}`);const r=await fiscalPosSeriesSave({pos_register_id:id,cash_number:draft.cash_number,fiscal_series_id:draft.fiscal_series_id||null,in_use:draft.in_use});setBusy('');if(r.ok)await refresh('Configuração fiscal do caixa salva.');else setMessage(err(r.error));}

  function resetCfop(){setCfopEdit(null);setCfopCode('');setCfopName('');setCfopActive(true);}
  function editCfop(row:Row){setCfopEdit(row);setCfopCode(txt(row.code));setCfopName(txt(row.name));setCfopActive(row.active!==false);}
  async function saveCfop(e:FormEvent){e.preventDefault();setBusy('cfop');const r=await fiscalCfopSave({id:cfopEdit?.id??null,code:cfopCode,name:cfopName,active:cfopActive});setBusy('');if(r.ok){resetCfop();await refresh('CFOP salvo.')}else setMessage(err(r.error));}

  return <div className="fiscal-config-stack">
    <section className="erp-module-card fiscal-config-card">
      <div className="fiscal-section-head"><div><h2>Configurações da NFC-e</h2><p>Defina as informações fiscais fornecidas pela SEFAZ e o ambiente utilizado na emissão.</p></div><span className="fiscal-config-tag">NFC-e</span></div>
      <form className="fiscal-config-form" onSubmit={saveGeneral}>
        <label>Ambiente<select value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="homologation">Homologação</option><option value="production">Produção</option></select></label>
        <label>Número de identificação<input value={cscId} onChange={e=>setCscId(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="ID CSC"/></label>
        <label className="wide">Token de identificação de contribuinte<input type="password" autoComplete="new-password" value={cscToken} onChange={e=>setCscToken(e.target.value)} placeholder={settings.csc_token_configured?'Token já configurado — preencha apenas para substituir':'Informe o CSC fornecido pela SEFAZ'}/><small>O token é armazenado cifrado e não é exibido novamente.</small></label>
        <div className="fiscal-config-actions wide"><button className="erp-primary" disabled={busy==='general'}>{busy==='general'?'Salvando...':'Salvar NFC-e / DANFE'}</button>{bool(settings.csc_token_configured)&&<button type="button" className="erp-ghost" onClick={clearToken}>Remover token CSC</button>}</div>
      </form>
    </section>

    <section className="erp-module-card fiscal-config-card">
      <div className="fiscal-section-head"><div><h2>Séries fiscais e numeração</h2><p>Cadastre várias séries para NF-e e NFC-e. O campo “Última nota fiscal” define qual será o próximo número reservado pelo servidor.</p></div><span className="fiscal-config-tag">Numeração</span></div>
      <form className="fiscal-series-form" onSubmit={saveSeries}>
        <label>Modelo<select value={seriesModel} disabled={Boolean(seriesEdit)&&bool(seriesEdit?.in_use_by_cash)} onChange={e=>setSeriesModel(e.target.value as 'nfe'|'nfce')}><option value="nfce">NFC-e</option><option value="nfe">NF-e</option></select></label>
        <label>Série<input type="number" min="1" max="999" required value={seriesNumber} onChange={e=>setSeriesNumber(e.target.value)}/></label>
        <label>Descrição<input value={seriesLabel} onChange={e=>setSeriesLabel(e.target.value)} placeholder="Ex.: NFC-e Caixa 01"/></label>
        <label>Última nota fiscal<input type="number" min="0" max="999999999" required value={lastNumber} onChange={e=>setLastNumber(e.target.value)}/><small>Próxima: {Math.max(0,Number(lastNumber)||0)+1}</small></label>
        <label className="fiscal-check"><input type="checkbox" checked={seriesDefault} onChange={e=>setSeriesDefault(e.target.checked)}/> Série padrão</label>
        <label className="fiscal-check"><input type="checkbox" checked={seriesActive} onChange={e=>setSeriesActive(e.target.checked)}/> Ativa</label>
        <div className="fiscal-config-actions"><button className="erp-primary" disabled={busy==='series'}>{seriesEdit?'Salvar alterações':'Adicionar série'}</button>{seriesEdit&&<button type="button" className="erp-ghost" onClick={resetSeries}>Cancelar</button>}</div>
      </form>
      <div className="erp-table-scroll"><table className="erp-data-table fiscal-config-table"><thead><tr><th>Modelo</th><th>Série</th><th>Descrição</th><th>Última nota fiscal</th><th>Próxima</th><th>Padrão</th><th>Status</th><th>Caixa</th><th>Ação</th></tr></thead><tbody>{series.map(s=><tr key={txt(s.id)}><td><b>{modelLabel(s.document_type)}</b></td><td>{txt(s.series).padStart(3,'0')}</td><td>{txt(s.label)||'—'}</td><td>{txt(s.last_number)}</td><td><b>{txt(s.next_number)}</b></td><td>{bool(s.is_default)?'Sim':'Não'}</td><td><span className={`erp-pill ${s.active===false?'danger':''}`}>{s.active===false?'Inativa':'Ativa'}</span></td><td>{bool(s.in_use_by_cash)?'Em uso':'—'}</td><td><button type="button" className="erp-row-action" onClick={()=>editSeries(s)}>Editar</button></td></tr>)}</tbody></table></div>
    </section>

    <section className="erp-module-card fiscal-config-card">
      <div className="fiscal-section-head"><div><h2>Caixas</h2><p>Associe cada caixa do ThorPDV a uma série fiscal exclusiva de NFC-e.</p></div><span className="fiscal-config-tag">Caixa → Série</span></div>
      <div className="erp-table-scroll"><table className="erp-data-table fiscal-cash-table"><thead><tr><th>Número do caixa</th><th>Caixa / PDV</th><th>Série fiscal</th><th>Em uso</th><th>Ação</th></tr></thead><tbody>{pos.length===0?<tr><td colSpan={5} className="erp-empty">Nenhum caixa/PDV cadastrado nesta filial.</td></tr>:pos.map(p=>{const id=txt(p.id);const d=posDrafts[id]??{cash_number:txt(p.code),fiscal_series_id:'',in_use:false};return <tr key={id}><td><input value={d.cash_number} onChange={e=>changePos(id,'cash_number',e.target.value)} placeholder="01"/></td><td><b>{txt(p.name)}</b><small>{txt(p.code)?`Código ${txt(p.code)}`:''}</small></td><td><select value={d.fiscal_series_id} disabled={!d.in_use} onChange={e=>changePos(id,'fiscal_series_id',e.target.value)}><option value="">Selecione...</option>{nfceSeries.map(s=><option key={txt(s.id)} value={txt(s.id)}>Série {txt(s.series).padStart(3,'0')} · {txt(s.label)||'NFC-e'}</option>)}</select></td><td><label className="fiscal-check"><input type="checkbox" checked={d.in_use} onChange={e=>changePos(id,'in_use',e.target.checked)}/> {d.in_use?'Sim':'Não'}</label></td><td><button type="button" className="erp-row-action" disabled={busy===`pos:${id}`} onClick={()=>savePos(p)}>{busy===`pos:${id}`?'Salvando...':'Salvar'}</button></td></tr>})}</tbody></table></div>
      <p className="fiscal-helper">Um número de caixa e uma série marcada “Em uso” não podem ser utilizados simultaneamente por outro terminal da mesma operação.</p>
    </section>

    <section className="erp-module-card fiscal-config-card">
      <div className="fiscal-section-head"><div><h2>Nota Fiscal Eletrônica (NF-e) · DANFE</h2><p>Configure como os produtos serão organizados e apresentados na impressão do DANFE.</p></div><span className="fiscal-config-tag">DANFE</span></div>
      <form className="fiscal-danfe-grid" onSubmit={saveGeneral}>
        <label>Casas decimais do valor unitário no DANFE<select value={decimalPlaces} onChange={e=>setDecimalPlaces(Number(e.target.value))}>{[2,3,4,5,6].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        <label>Número de linhas no nome do produto na impressão<select value={productLines} onChange={e=>setProductLines(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        <label>Ordenação dos itens (DANFE)<select value={itemOrder} onChange={e=>setItemOrder(e.target.value)}>{Object.entries(orderLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Formação do nome do produto<input value={nameFormat} onChange={e=>setNameFormat(e.target.value)} placeholder="{nome}"/><small>Marcadores disponíveis para a configuração: {'{nome}'}, {'{codigo}'}, {'{sku}'}. Ex.: {'{codigo} - {nome}'}.</small></label>
        <button className="erp-primary" disabled={busy==='general'}>{busy==='general'?'Salvando...':'Salvar configuração do DANFE'}</button>
      </form>
      <p className="fiscal-helper">Esses parâmetros ficam persistidos por filial e serão usados pelo gerador de DANFE. A autorização eletrônica da NF-e modelo 55 continua separada do layout de impressão.</p>
    </section>

    <section className="erp-module-card fiscal-config-card">
      <div className="fiscal-section-head"><div><h2>Lista de CFOPs</h2><p>CFOPs disponíveis para cadastro tributário de produtos e operações. A lista inicial foi pré-carregada com os códigos informados.</p></div><span className="fiscal-config-tag">{cfops.length} CFOPs</span></div>
      <form className="fiscal-cfop-form" onSubmit={saveCfop}><label>Código<input inputMode="numeric" maxLength={4} required value={cfopCode} onChange={e=>setCfopCode(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="5102"/></label><label className="wide">Nome<input required value={cfopName} onChange={e=>setCfopName(e.target.value)} placeholder="Descrição do CFOP"/></label><label className="fiscal-check"><input type="checkbox" checked={cfopActive} onChange={e=>setCfopActive(e.target.checked)}/> Ativo</label><div className="fiscal-config-actions"><button className="erp-primary" disabled={busy==='cfop'}>{cfopEdit?'Salvar CFOP':'Adicionar CFOP'}</button>{cfopEdit&&<button type="button" className="erp-ghost" onClick={resetCfop}>Cancelar</button>}</div></form>
      <div className="fiscal-cfop-search"><input value={cfopSearch} onChange={e=>setCfopSearch(e.target.value)} placeholder="Pesquisar por código ou nome..."/><span>{filteredCfops.length} resultado(s)</span></div>
      <div className="erp-table-scroll fiscal-cfop-scroll"><table className="erp-data-table fiscal-config-table"><thead><tr><th>Código</th><th>Nome</th><th>Operação</th><th>Status</th><th>Ações</th></tr></thead><tbody>{filteredCfops.map(c=><tr key={txt(c.id)}><td><b>{txt(c.code)}</b></td><td>{txt(c.name)}</td><td>{c.direction==='entry'?'Entrada':'Saída'}</td><td><span className={`erp-pill ${c.active===false?'danger':''}`}>{c.active===false?'Inativo':'Ativo'}</span></td><td><button type="button" className="erp-row-action" onClick={()=>editCfop(c)}>Editar</button></td></tr>)}</tbody></table></div>
    </section>
    {message&&<div className="erp-message fiscal-config-message">{message}</div>}
  </div>;
}

function makePosDrafts(settings:Row){const rows=(Array.isArray(settings.pos_registers)?settings.pos_registers:[]) as Row[];return Object.fromEntries(rows.map(p=>[txt(p.id),{cash_number:txt(p.cash_number)||txt(p.code)||'',fiscal_series_id:txt(p.fiscal_series_id),in_use:bool(p.in_use)}]));}
