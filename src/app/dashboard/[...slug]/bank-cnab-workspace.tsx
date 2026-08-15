'use client';

import { FormEvent, useMemo, useState } from 'react';
import { cnab400Data, generateCnab400Remittance, importCnab400Return, markCnab400RemittanceSent, saveCnab400Config } from './bank-cnab-actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const money=(v:unknown)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const dateTime=(v:unknown)=>{if(!v)return '—';const d=new Date(String(v));return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR')};
const configErrors:Record<string,string>={invalid_session:'Sua sessão expirou.',bank_account_not_found:'Conta bancária não encontrada.',company_cnpj_required:'O CNPJ da empresa precisa estar completo antes de configurar a cobrança.',cnab_agency_must_have_4_digits:'Informe a agência Itaú com 4 dígitos.',cnab_account_must_have_5_digits:'No CNAB 400 Itaú a conta corrente deve possuir 5 dígitos, sem o DAC.',cnab_account_digit_required:'Informe o DAC da conta corrente.',cnab_wallet_not_supported:'Nesta primeira versão utilize a carteira 109.',cnab_species_invalid:'Espécie do título inválida.',cnab_acceptance_invalid:'Aceite inválido.'};
const flowErrors:Record<string,string>={select_receivables:'Selecione pelo menos um título para gerar a remessa.',too_many_receivables:'Selecione no máximo 500 títulos por arquivo.',cnab_config_not_found:'Configure e ative a conta bancária para CNAB 400.',invalid_receivables:'Há título inválido ou já quitado na seleção.',receivable_already_in_active_remittance:'Um dos títulos selecionados já está em uma remessa ativa.',payer_document_invalid:'CPF/CNPJ do pagador inválido.',payer_data_incomplete:'Complete os dados cadastrais do pagador antes de gerar a remessa.',cnab_our_number_sequence_exhausted:'A sequência de Nosso Número atingiu o limite da carteira.',return_file_empty:'O arquivo retorno está vazio.',return_not_itau_cnab400:'O arquivo não foi reconhecido como retorno Itaú CNAB 400.'};
const friendlyError=(r:Row)=>configErrors[text(r.error)]||flowErrors[text(r.error)]||text(r.detail||r.error||'Não foi possível concluir a operação.');

export function BankCnabWorkspace({initial}:{initial:Row}){
  const [data,setData]=useState<Row>(initial);
  const [configOpen,setConfigOpen]=useState(false);
  const [selectedConfig,setSelectedConfig]=useState(text((Array.isArray(initial.configs)?initial.configs[0] as Row:undefined)?.id));
  const [selectedEntries,setSelectedEntries]=useState<string[]>([]);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [returnFile,setReturnFile]=useState<File|null>(null);
  const accounts=Array.isArray(data.accounts)?data.accounts as Row[]:[];
  const configs=Array.isArray(data.configs)?data.configs as Row[]:[];
  const receivables=Array.isArray(data.receivables)?data.receivables as Row[]:[];
  const remittances=Array.isArray(data.remittances)?data.remittances as Row[]:[];
  const returns=Array.isArray(data.returns)?data.returns as Row[]:[];
  const activeConfig=useMemo(()=>configs.find(c=>text(c.id)===selectedConfig),[configs,selectedConfig]);
  const eligible=useMemo(()=>receivables.filter(r=>!r.validation_error&&!r.remitted),[receivables]);
  const selectedRows=useMemo(()=>receivables.filter(r=>selectedEntries.includes(text(r.id))),[receivables,selectedEntries]);
  const selectedTotal=useMemo(()=>selectedRows.reduce((sum,r)=>sum+Number(r.remaining||0),0),[selectedRows]);

  async function refresh(){const r=await cnab400Data();if(r.ok){setData(r);const next=Array.isArray(r.configs)?r.configs as Row[]:[];if(!selectedConfig&&next[0]?.id)setSelectedConfig(text(next[0].id));}}
  function toggle(id:string){setSelectedEntries(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);}
  function selectAll(){setSelectedEntries(current=>current.length===eligible.length?[]:eligible.map(r=>text(r.id)));}

  async function saveConfig(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setMessage('');const fd=new FormData(e.currentTarget);
    const accountId=text(fd.get('bank_account_id'));
    const r=await saveCnab400Config(accountId,{agency:text(fd.get('agency')),account_number:text(fd.get('account_number')),account_digit:text(fd.get('account_digit')),wallet:'109',species:text(fd.get('species'))||'01',acceptance:text(fd.get('acceptance'))||'N',initial_our_number:text(fd.get('initial_our_number'))||'0',active:true});
    setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}setConfigOpen(false);setSelectedConfig(text(r.config_id));setMessage('Configuração Itaú CNAB 400 salva. Agora selecione os títulos e gere a remessa.');await refresh();
  }

  function download(name:string,content:string){
    const blob=new Blob([content],{type:'text/plain;charset=us-ascii'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  async function generate(){
    if(!selectedConfig){setMessage('Configure uma conta Itaú CNAB 400 antes de gerar a remessa.');return;}
    if(!selectedEntries.length){setMessage('Selecione pelo menos um título.');return;}
    setBusy(true);setMessage('');const r=await generateCnab400Remittance(selectedConfig,selectedEntries);setBusy(false);
    if(!r.ok){setMessage(friendlyError(r));return;}
    download(text(r.file_name)||'REMESSA.REM',text(r.content));setSelectedEntries([]);setMessage(`Remessa ${text(r.file_name)} gerada com ${text(r.record_count)} título(s), total ${money(r.total_amount)}. Envie o arquivo no Itaú Empresas e depois marque como enviado.`);await refresh();
  }

  async function markSent(id:string){setBusy(true);const r=await markCnab400RemittanceSent(id);setBusy(false);if(!r.ok){setMessage(friendlyError(r));return;}setMessage('Remessa marcada como enviada ao banco.');await refresh();}

  async function importReturn(){
    if(!selectedConfig){setMessage('Selecione a configuração bancária correspondente ao retorno.');return;}
    if(!returnFile){setMessage('Selecione um arquivo .RET do Itaú.');return;}
    setBusy(true);setMessage('');
    let content='';try{content=await returnFile.text();}catch{setBusy(false);setMessage('Não foi possível ler o arquivo selecionado.');return;}
    const r=await importCnab400Return(selectedConfig,returnFile.name,content);setBusy(false);
    if(!r.ok){setMessage(friendlyError(r));return;}
    if(r.already_imported)setMessage(`Este retorno já havia sido importado. Nenhuma baixa foi duplicada. Arquivo: ${returnFile.name}.`);
    else setMessage(`Retorno processado: ${text(r.matched_count)} título(s) localizado(s), ${text(r.paid_count)} quitado(s), ${text(r.error_count)} pendência(s).`);
    setReturnFile(null);const el=document.getElementById('cnab-return-file') as HTMLInputElement|null;if(el)el.value='';await refresh();
  }

  return <div className="cnab-studio">
    <section className="cnab-hero"><div><span>COBRANÇA POR ARQUIVO</span><h1>Remessa / Retorno</h1><p>Registre boletos no Itaú por CNAB 400 e importe o retorno para dar baixa automática no Contas a Receber.</p></div><div className="cnab-hero-badge"><b>CNAB 400</b><span>Itaú · Banco 341</span></div></section>

    <section className="cnab-flow">
      <div><i>1</i><b>Configurar</b><span>Agência, conta, DAC e carteira</span></div><div><i>2</i><b>Gerar .REM</b><span>Selecionar títulos em aberto</span></div><div><i>3</i><b>Enviar ao Itaú</b><span>Transmissão de arquivos</span></div><div><i>4</i><b>Baixar .RET</b><span>Retorno processado pelo banco</span></div><div><i>5</i><b>Importar</b><span>Baixa e conciliação automáticas</span></div>
    </section>

    {message?<div className="cnab-message" onClick={()=>setMessage('')}><span>{message}</span><button>×</button></div>:null}

    <section className="cnab-toolbar">
      <label>Conta / convênio<select value={selectedConfig} onChange={e=>setSelectedConfig(e.target.value)}><option value="">Selecione...</option>{configs.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.account_name)} · ag. {text(c.agency)} · conta {text(c.account_number)}-{text(c.account_digit)}</option>)}</select></label>
      <button className="secondary" onClick={()=>void refresh()} disabled={busy}>↻ Atualizar</button><button className="primary" onClick={()=>setConfigOpen(true)}>⚙ Configurar CNAB</button>
    </section>

    {activeConfig?<section className="cnab-config-summary"><div><small>CONTA CONFIGURADA</small><b>{text(activeConfig.account_name)}</b><span>Ag. {text(activeConfig.agency)} · Conta {text(activeConfig.account_number)}-{text(activeConfig.account_digit)}</span></div><div><small>CARTEIRA</small><b>{text(activeConfig.wallet)}</b><span>Direta eletrônica sem emissão</span></div><div><small>PRÓXIMA REMESSA</small><b>{Number(activeConfig.remittance_sequence||0)+1}</b><span>Nosso Número atual {text(activeConfig.our_number_sequence)||'0'}</span></div></section>:<section className="cnab-empty-config"><b>Nenhum convênio CNAB 400 configurado</b><span>Cadastre os dados da cobrança Itaú antes de gerar a primeira remessa.</span><button className="primary" onClick={()=>setConfigOpen(true)}>Configurar agora</button></section>}

    <section className="cnab-panel">
      <header><div><span>ARQUIVO REMESSA</span><h2>Títulos para registro</h2><p>Somente boletos em aberto e com cadastro completo do pagador podem entrar na remessa.</p></div><div className="cnab-selection"><b>{selectedEntries.length}</b><span>selecionados · {money(selectedTotal)}</span></div></header>
      <div className="cnab-panel-actions"><button className="secondary" onClick={selectAll} disabled={!eligible.length}>{selectedEntries.length===eligible.length&&eligible.length?'Desmarcar todos':'Selecionar elegíveis'}</button><button className="primary" onClick={()=>void generate()} disabled={busy||!selectedEntries.length||!selectedConfig}>{busy?'Processando...':'Gerar arquivo .REM'}</button></div>
      <div className="cnab-table"><table><thead><tr><th></th><th>Cliente</th><th>Título</th><th>Vencimento</th><th>Saldo</th><th>Situação</th></tr></thead><tbody>{receivables.length===0?<tr><td colSpan={6} className="empty">Nenhum boleto em aberto.</td></tr>:receivables.map(r=>{const id=text(r.id);const blocked=Boolean(r.validation_error)||Boolean(r.remitted);return <tr key={id} className={blocked?'muted':''}><td><input type="checkbox" checked={selectedEntries.includes(id)} disabled={blocked} onChange={()=>toggle(id)}/></td><td><b>{text(r.customer)||'—'}</b><small>{text(r.document)||'CPF/CNPJ não informado'}</small></td><td>{text(r.description)||id.slice(0,8)}</td><td>{date(r.due_date)}</td><td><b>{money(r.remaining)}</b></td><td>{r.remitted?<span className="tag sent">Já em remessa</span>:r.validation_error?<span className="tag error">{text(r.validation_error)}</span>:<span className="tag ready">Pronto</span>}</td></tr>})}</tbody></table></div>
    </section>

    <section className="cnab-grid">
      <article className="cnab-panel return-panel"><header><div><span>ARQUIVO RETORNO</span><h2>Importar .RET</h2><p>O Thor identifica confirmação, rejeição e liquidação e impede processamento duplicado.</p></div></header><div className="return-drop"><input id="cnab-return-file" type="file" accept=".ret,.RET,.txt,text/plain" onChange={e=>setReturnFile(e.target.files?.[0]||null)}/><div><b>{returnFile?returnFile.name:'Selecione o retorno do Itaú'}</b><span>{returnFile?`${Math.ceil(returnFile.size/1024)} KB`:'Arquivo CNAB 400 recebido pelo Itaú Empresas'}</span></div></div><button className="primary wide" disabled={busy||!returnFile||!selectedConfig} onClick={()=>void importReturn()}>{busy?'Processando retorno...':'Importar e processar retorno'}</button><div className="cnab-safe"><b>Baixa segura</b><span>O mesmo arquivo não pode quitar o título duas vezes: o conteúdo é identificado por SHA-256.</span></div></article>

      <article className="cnab-panel"><header><div><span>ÚLTIMAS REMESSAS</span><h2>Arquivos gerados</h2></div></header><div className="cnab-history">{remittances.length===0?<p>Nenhuma remessa gerada.</p>:remittances.slice(0,8).map(r=><div key={text(r.id)}><div><b>{text(r.file_name)}</b><span>{dateTime(r.generated_at)} · {text(r.record_count)} título(s) · {money(r.total_amount)}</span></div><span className={`tag ${text(r.status)}`}>{text(r.status)==='generated'?'Gerada':text(r.status)==='sent'?'Enviada':text(r.status)==='processed'?'Processada':text(r.status)}</span>{text(r.status)==='generated'?<button onClick={()=>void markSent(text(r.id))} disabled={busy}>Marcar enviada</button>:null}</div>)}</div></article>
    </section>

    <section className="cnab-panel"><header><div><span>RETORNOS PROCESSADOS</span><h2>Histórico de importação</h2></div></header><div className="cnab-table"><table><thead><tr><th>Arquivo</th><th>Importado em</th><th>Localizados</th><th>Quitados</th><th>Pendências</th><th>Status</th></tr></thead><tbody>{returns.length===0?<tr><td colSpan={6} className="empty">Nenhum retorno importado.</td></tr>:returns.map(r=><tr key={text(r.id)}><td><b>{text(r.file_name)}</b><small>Seq. banco {text(r.bank_file_sequence)||'—'}</small></td><td>{dateTime(r.imported_at)}</td><td>{text(r.matched_count)}</td><td>{text(r.paid_count)}</td><td>{text(r.error_count)}</td><td><span className={`tag ${text(r.status)}`}>{text(r.status)==='processed'?'Processado':text(r.status)==='processed_with_errors'?'Com pendências':text(r.status)}</span></td></tr>)}</tbody></table></div></section>

    {configOpen?<div className="cnab-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setConfigOpen(false)}}><section className="cnab-modal"><header><div><span>CONVÊNIO DE COBRANÇA</span><h2>Configurar Itaú CNAB 400</h2><p>Use os dados do contrato de cobrança. A conta do CNAB 400 possui 5 dígitos sem o DAC.</p></div><button onClick={()=>setConfigOpen(false)}>×</button></header><form onSubmit={saveConfig}><label className="wide">Conta bancária<select required name="bank_account_id" defaultValue={text(activeConfig?.bank_account_id)||''}><option value="">Selecione...</option>{accounts.filter(a=>text(a.bank_code)==='341'||!text(a.bank_code)).map(a=><option value={text(a.id)} key={text(a.id)}>{text(a.name)} · Banco {text(a.bank_code)||'não definido'}</option>)}</select></label><label>Agência (4 dígitos)<input required name="agency" inputMode="numeric" maxLength={4} defaultValue={text(activeConfig?.agency)} placeholder="0057"/></label><label>Conta (5 dígitos)<input required name="account_number" inputMode="numeric" maxLength={5} defaultValue={text(activeConfig?.account_number)} placeholder="12345"/></label><label>DAC da conta<input required name="account_digit" inputMode="numeric" maxLength={1} defaultValue={text(activeConfig?.account_digit)} placeholder="7"/></label><label>Carteira<input readOnly name="wallet" value="109"/></label><label>Espécie<select name="species" defaultValue={text(activeConfig?.species)||'01'}><option value="01">01 — Duplicata Mercantil</option><option value="05">05 — Recibo</option><option value="06">06 — Contrato</option><option value="08">08 — Duplicata de Serviços</option><option value="17">17 — Conta de Prestação de Serviços</option><option value="99">99 — Diversos</option></select></label><label>Aceite<select name="acceptance" defaultValue={text(activeConfig?.acceptance)||'N'}><option value="N">N — Não aceito</option><option value="A">A — Aceito</option></select></label><label className="wide">Nosso Número inicial<input name="initial_our_number" type="number" min="0" max="99999999" defaultValue={text(activeConfig?.our_number_sequence)||'0'}/><small>Na carteira 109, informe a última sequência autorizada/ utilizada. Na primeira implantação confirme a faixa com o Itaú.</small></label><div className="cnab-warning wide"><b>Importante</b><span>Este cadastro substitui a integração BoleCode/API. Não exige Client ID, Client Secret, certificado nem webhook.</span></div><div className="actions wide"><button type="button" onClick={()=>setConfigOpen(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Salvando...':'Salvar configuração'}</button></div></form></section></div>:null}
  </div>;
}
