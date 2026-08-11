from pathlib import Path
import json
import re

# ---- ThorFiscal Edge Function -------------------------------------------------
p = Path('supabase/functions/thorfiscal-authorize/index.ts')
s = p.read_text()

helper_anchor = '''function buildNfeProc(signedXml: string, protNFe: string) {'''
helpers = r'''function classifyTransmissionError(message: string) {
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

'''
if 'function classifyTransmissionError' not in s:
    if helper_anchor not in s:
        raise SystemExit('edge helper anchor not found')
    s = s.replace(helper_anchor, helpers + helper_anchor, 1)

transmit_pattern = re.compile(r'''async function transmit\(signedXml: string, uf: string, homologation: boolean, certPem: string, privateKeyPem: string\) \{.*?\n\}\n\nasync function adminClient''', re.S)
new_transmit = r'''async function transmit(signedXml: string, uf: string, homologation: boolean, certPem: string, privateKeyPem: string) {
  const environment = homologation ? "homologacao" : "producao";
  const url = getSefazUrl(uf, environment as any, "NFCeAutorizacao" as any);
  if (!url) throw new Error("sefaz_nfce_endpoint_not_configured");

  const caBundle = str(Deno.env.get("SEFAZ_CA_BUNDLE_PEM"));
  const clientOptions: any = { cert: certPem, key: privateKeyPem };
  if (caBundle) clientOptions.caCerts = [caBundle];
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
    return { body, url, httpStatus: response.status };
  } finally {
    clearTimeout(timer);
    (client as any).close?.();
  }
}

async function adminClient'''
if 'sefaz_timeout_30000ms' not in s:
    s2, count = transmit_pattern.subn(new_transmit, s, count=1)
    if count != 1:
        raise SystemExit(f'edge transmit replacement failed: {count}')
    s = s2

old = '''  const doc = claim.document ?? {};
  let signedXml = str(doc.request_payload?.signed_xml || claim.document?.request_payload?.signed_xml);
  let accessKey = str(doc.access_key);
  let qrCodeUrl = str(doc.request_payload?.qr_code_url);
  const wasProcessing = str(doc.status) === "processing";

  try {
    const cert = parsePfx(claim.certificate.pfx_base64, claim.certificate.password);

    if (!(wasProcessing && signedXml && accessKey)) {
      const built = buildNfe(claim);'''
new = '''  const doc = claim.document ?? {};
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
      const built = buildNfe(claim);'''
if old in s:
    s = s.replace(old, new, 1)
elif 'const canReuseStagedXml' not in s:
    raise SystemExit('edge handler initial anchor not found')

old = '''      if (stageError) throw new Error(`stage_failed:${stageError.message}`);
    }

    const uf = str(claim.branch.state).toUpperCase();
    const homologation = str(doc.environment || claim.settings?.environment) !== "production";
    const transmitted = await transmit(signedXml, uf, homologation, cert.certPem, cert.privateKeyPem);
    const result = parseAuthorization(transmitted.body);
    const authorized = result.cStat === "100" || result.cStat === "150";
'''
new = '''      if (stageError) throw new Error(`stage_failed:${stageError.message}`);
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
'''
if old in s:
    s = s.replace(old, new, 1)
elif 'sending_to_sefaz' not in s:
    raise SystemExit('edge transmission anchor not found')

old = '''          rejection_code: null,
          rejection_message: null,
          provider: "svrs_direct",'''
new = '''          rejection_code: null,
          rejection_message: null,
          last_error_code: null,
          last_error_message: null,
          provider: "svrs_direct",'''
if old in s:
    s = s.replace(old, new, 1)

old = '''      if (updateError) throw new Error(`authorization_persist_failed:${updateError.message}`);

      return json({'''
new = '''      if (updateError) throw new Error(`authorization_persist_failed:${updateError.message}`);
      await fiscalEvent(supabase, tenantId, documentId, "authorized", "success", result.xMotivo || "NFC-e autorizada pela SEFAZ.", result.cStat || "100", { protocol: result.nProt || null, access_key: result.chNFe || accessKey });

      return json({'''
if old in s:
    s = s.replace(old, new, 1)
elif '"authorized", "success"' not in s:
    raise SystemExit('edge authorized event anchor not found')

old = '''        rejection_code: result.cStat || "unknown",
        rejection_message: result.xMotivo || "Rejeição sem motivo informado",
        response_payload: {'''
new = '''        rejection_code: result.cStat || "unknown",
        rejection_message: result.xMotivo || "Rejeição sem motivo informado",
        last_error_code: null,
        last_error_message: null,
        response_payload: {'''
if old in s:
    s = s.replace(old, new, 1)

old = '''      .eq("id", documentId);

    return json({
      ok: false,
      authorized: false,
      status: "rejected",'''
new = '''      .eq("id", documentId);
    await fiscalEvent(supabase, tenantId, documentId, "rejected", "error", result.xMotivo || "NFC-e rejeitada pela SEFAZ.", result.cStat || "unknown", { access_key: accessKey, endpoint: transmitted.url });

    return json({
      ok: false,
      authorized: false,
      status: "rejected",'''
if old in s:
    s = s.replace(old, new, 1)
elif '"rejected", "error"' not in s:
    raise SystemExit('edge rejected event anchor not found')

catch_pattern = re.compile(r'''  \} catch \(error\) \{\n    const message = error instanceof Error \? error\.message : String\(error\);\n    const validationErrors = \(error as any\)\?\.validationErrors;\n    const isValidation = .*?\n    return json\(\{\n      ok: false,\n      authorized: false,\n      status: isValidation \? "rejected" : "processing",\n      document_id: documentId,\n      access_key: accessKey \|\| null,\n      error: isValidation \? "local_validation" : "transmission_failed",\n      detail: message,\n      validation_errors: validationErrors \?\? undefined,\n      retryable: !isValidation,\n    \}, isValidation \? 400 : 502\);\n  \}\n\}\);''', re.S)
new_catch = r'''  } catch (error) {
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
      { retryable: !isValidation, access_key: accessKey || null },
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
});'''
if 'status: isValidation ? "rejected" : "processing"' in s:
    s2, count = catch_pattern.subn(new_catch, s, count=1)
    if count != 1:
        raise SystemExit(f'edge catch replacement failed: {count}')
    s = s2

p.write_text(s)

# ---- Desktop renderer ---------------------------------------------------------
p = Path('desktop-pdv/renderer/app.js')
s = p.read_text()

helpers_anchor = "const saleKey=(sale)=>String(sale.id||sale.local_key||sale.client_event_id||sale.number||'');\n"
helpers = r'''
const fiscalTerminalStatuses=new Set(['authorized','rejected','transmission_error','cancelled','contingency']);
const sefazQuickCodes={
  '106':'Lote não localizado','108':'Serviço paralisado momentaneamente','110':'Uso denegado',
  '202':'Falha no reconhecimento da autoria ou integridade do arquivo digital','203':'Emissor não habilitado para emissão',
  '204':'Duplicidade de NF-e/NFC-e','207':'CNPJ do emitente inválido','209':'IE do emitente inválida',
  '225':'Falha no Schema XML do lote','230':'IE do emitente não cadastrada','231':'IE do emitente não vinculada ao CNPJ',
  '243':'XML mal formado','245':'CNPJ emitente não cadastrado','280':'Certificado transmissor inválido',
  '281':'Certificado transmissor fora da validade','283':'Erro na cadeia do certificado transmissor',
  '290':'Certificado da assinatura inválido','291':'Certificado da assinatura fora da validade','293':'Erro na cadeia do certificado da assinatura',
  '301':'Irregularidade fiscal do emitente','302':'Irregularidade fiscal do destinatário',
  '387':'Código de enquadramento legal do IPI inválido','388':'CST do IPI incompatível com o enquadramento legal'
};
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
function fiscalCode(fiscal){return String(fiscal?.cStat||fiscal?.rejection_code||'').trim();}
function fiscalReason(fiscal){
  if(!fiscal)return '';
  const code=fiscalCode(fiscal);
  if(fiscal.status==='transmission_error'){
    const e=String(fiscal.last_error_code||'');
    if(e==='tls_unknown_issuer')return 'Falha TLS: a cadeia do certificado do servidor da SEFAZ não foi reconhecida pelo ambiente de transmissão.';
    if(e==='sefaz_timeout')return 'Tempo limite excedido aguardando comunicação com a SEFAZ.';
    return fiscal.last_error_message||'Falha de comunicação com a SEFAZ.';
  }
  return fiscal.xMotivo||fiscal.rejection_message||(code?sefazQuickCodes[code]:'')||'';
}
function fiscalTimelineHtml(fiscal){
  const events=Array.isArray(fiscal?.events)?fiscal.events:[];
  if(!events.length)return '<div class="fiscal-log-empty">Ainda não há eventos sincronizados para esta tentativa.</div>';
  return `<div class="fiscal-event-list">${events.map(e=>`<div class="fiscal-event fiscal-event-${esc(e.level||'info')}"><i></i><div><b>${esc(e.message||e.type||'Evento fiscal')}</b><small>${dt(e.created_at)}${e.code?` • ${esc(e.code)}`:''}</small></div></div>`).join('')}</div>`;
}
function fiscalDiagnosticHtml(fiscal){
  if(!fiscal)return '<div class="fiscal-diagnostic neutral">NFC-e ainda não solicitada.</div>';
  const code=fiscalCode(fiscal),reason=fiscalReason(fiscal);
  if(fiscal.status==='authorized')return `<div class="fiscal-diagnostic success"><b>Autorizada pela SEFAZ</b><span>${code?`cStat ${esc(code)} • `:''}${esc(reason||'Autorização concluída.')}</span></div>`;
  if(fiscal.status==='rejected')return `<div class="fiscal-diagnostic error"><b>Rejeitada pela SEFAZ${code?` — código ${esc(code)}`:''}</b><span>${esc(reason||'A SEFAZ rejeitou o documento.')}</span></div>`;
  if(fiscal.status==='transmission_error')return `<div class="fiscal-diagnostic error"><b>Falha de transmissão${fiscal.last_error_code?` — ${esc(fiscal.last_error_code)}`:''}</b><span>${esc(reason)}</span>${fiscal.last_error_message&&fiscal.last_error_message!==reason?`<code>${esc(fiscal.last_error_message)}</code>`:''}</div>`;
  return `<div class="fiscal-diagnostic processing"><b><i class="fiscal-live-dot"></i> Comunicação fiscal em andamento</b><span>${esc(reason||'Aguardando conclusão da transmissão.')}</span></div>`;
}
function fiscalProgressSteps(fiscal,phase){
  const status=String(fiscal?.status||'requested');
  const hasKey=Boolean(fiscal?.access_key);
  const hasResponse=Boolean(fiscalCode(fiscal))||['authorized','rejected'].includes(status);
  const failed=status==='transmission_error';
  const steps=[
    ['Preparando solicitação',true,phase==='queueing'],
    ['Gerando e assinando XML',hasKey,phase==='building'],
    ['Enviando à SEFAZ',hasResponse||failed||status==='processing',phase==='sending'||status==='processing'],
    ['Recebendo retorno',hasResponse,phase==='waiting'&&!failed],
    ['Resultado fiscal',fiscalTerminalStatuses.has(status),false],
  ];
  return `<div class="fiscal-progress-steps">${steps.map(([label,done,active])=>`<div class="fiscal-progress-step ${done?'done':''} ${active&&!done?'active':''}"><i>${done?'✓':''}</i><span>${label}</span></div>`).join('')}</div>`;
}
function paintFiscalProgress(m,sale,phase='waiting'){
  if(!m?.isConnected)return;
  const fiscal=sale?.fiscal||{status:'requested'};
  const status=String(fiscal.status||'requested');
  const title=status==='authorized'?'NFC-e autorizada':status==='rejected'?'NFC-e rejeitada':status==='transmission_error'?'Falha no envio da NFC-e':'Transmitindo NFC-e';
  const body=m.querySelector('#fiscalProgressBody');if(!body)return;
  body.innerHTML=`<div class="fiscal-progress-head"><div class="fiscal-spinner ${fiscalTerminalStatuses.has(status)?'stopped':''}"></div><div><small>THORFISCAL / SEFAZ</small><h3>${esc(title)}</h3><p>${status==='processing'?'Aguarde o retorno do autorizador. Não feche o PDV.':esc(fiscalReason(fiscal)||'Acompanhando a solicitação fiscal em tempo real.')}</p></div></div>${fiscalProgressSteps(fiscal,phase)}${fiscalDiagnosticHtml(fiscal)}<div class="fiscal-progress-meta"><span>Chave: <b>${esc(fiscal.access_key||'aguardando geração')}</b></span><span>Tentativas: <b>${Number(fiscal.attempt_count||0)}</b></span>${fiscalCode(fiscal)?`<span>cStat: <b>${esc(fiscalCode(fiscal))}</b></span>`:''}</div><h4>Eventos da transmissão</h4>${fiscalTimelineHtml(fiscal)}<div class="actions" id="fiscalProgressActions"></div>`;
  const actions=body.querySelector('#fiscalProgressActions');
  if(status==='transmission_error'||status==='rejected'){
    actions.innerHTML='<button class="secondary" id="fiscalClose">Fechar</button><button class="primary" id="fiscalRetry">Tentar novamente</button>';
    actions.querySelector('#fiscalClose').onclick=()=>m.remove();
    actions.querySelector('#fiscalRetry').onclick=()=>{m.remove();requestNfceAndMaybePrint(saleKey(sale));};
  }else if(status==='authorized'){
    actions.innerHTML='<button class="primary" id="fiscalClose">Fechar</button>';
    actions.querySelector('#fiscalClose').onclick=()=>m.remove();
  }
}
'''
if 'const fiscalTerminalStatuses=' not in s:
    if helpers_anchor not in s: raise SystemExit('desktop helper anchor not found')
    s=s.replace(helpers_anchor,helpers_anchor+helpers,1)

old="if(state.status.enrolled){await refreshProducts('');await refreshFiscalSales('');setInterval(refreshStatus,3000);}"
new="if(state.status.enrolled){await refreshProducts('');await refreshFiscalSales('');setInterval(async()=>{await refreshStatus();if(state.view==='fiscal'||state.fiscalSales.some(x=>['requested','draft','processing'].includes(String(x.fiscal?.status||''))))await refreshFiscalSales();},3000);}"
if old in s:s=s.replace(old,new,1)

req_pattern=re.compile(r'''async function requestNfceAndMaybePrint\(key\)\{.*?\n\}\n\nasync function safePrint''',re.S)
new_req=r'''async function requestNfceAndMaybePrint(key){
  const m=modal('<div id="fiscalProgressBody"></div>','wide');
  paintFiscalProgress(m,{fiscal:{status:'requested',events:[]}},'queueing');
  try{
    const requested=await window.thor.requestNfce({saleKey:key});
    if(requested.alreadyAuthorized){
      const done=await window.thor.fiscalSale(key);paintFiscalProgress(m,done,'done');await safePrint(key,'nfce');return;
    }

    paintFiscalProgress(m,{fiscal:{status:'processing',events:[]}},'sending');
    await window.thor.sync().catch(()=>{});
    const deadline=Date.now()+45000;
    let sale=null;
    while(Date.now()<deadline){
      await refreshFiscalSales();
      sale=await window.thor.fiscalSale(key);
      paintFiscalProgress(m,sale,'waiting');
      const status=String(sale?.fiscal?.status||'');
      if(fiscalTerminalStatuses.has(status))break;
      await wait(1500);
      await window.thor.sync().catch(()=>{});
    }

    if(!sale){sale=await window.thor.fiscalSale(key);paintFiscalProgress(m,sale,'waiting');}
    const status=String(sale?.fiscal?.status||'');
    if(status==='authorized'){
      await safePrint(key,'nfce');
      return;
    }
    if(status==='rejected'||status==='transmission_error')return;

    const actions=m.querySelector('#fiscalProgressActions');
    if(actions){actions.innerHTML='<button class="secondary" id="fiscalClose">Fechar</button><button class="primary" id="fiscalRefreshNow">Atualizar agora</button>';actions.querySelector('#fiscalClose').onclick=()=>m.remove();actions.querySelector('#fiscalRefreshNow').onclick=async()=>{await window.thor.sync().catch(()=>{});await refreshFiscalSales();const current=await window.thor.fiscalSale(key);paintFiscalProgress(m,current,'waiting');};}
    const diag=m.querySelector('.fiscal-diagnostic');if(diag)diag.outerHTML='<div class="fiscal-diagnostic warning"><b>Tempo de acompanhamento excedido</b><span>A solicitação não ficará escondida: use “Atualizar agora” para consultar o estado sincronizado.</span></div>';
  }catch(e){
    const body=m.querySelector('#fiscalProgressBody');if(body)body.innerHTML=`<h3>Falha ao iniciar NFC-e</h3><div class="fiscal-diagnostic error"><b>Não foi possível iniciar a transmissão</b><span>${esc(friendlyError(e.message))}</span></div><div class="actions"><button class="primary" id="fiscalClose">Fechar</button></div>`;
    m.querySelector('#fiscalClose')?.addEventListener('click',()=>m.remove());
  }
}

async function safePrint'''
if 'const m=modal(\'<div id="fiscalProgressBody"></div>\'' not in s:
    s2,count=req_pattern.subn(new_req,s,count=1)
    if count!=1:raise SystemExit(f'desktop requestNfce replacement failed {count}')
    s=s2

sale_detail_pattern=re.compile(r'''async function openSaleDetail\(sale\)\{.*?\n\}\n\nfunction cancelSaleModal''',re.S)
new_sale_detail=r'''async function openSaleDetail(sale){
  const key=saleKey(sale);let detail=sale;try{detail=await window.thor.fiscalSale(key);}catch{}
  const items=detail.items||[],payments=detail.payments||[],fiscal=detail.fiscal||null;
  const m=modal(`<div class="sale-detail-head"><div><small>VENDA ${detail.number?`#${esc(detail.number)}`:'LOCAL'}</small><h3>${money(detail.total)}</h3><p>${dt(detail.completed_at||detail.created_at)} • ${esc(detail.customer_name||'Consumidor')}</p></div>${fiscalBadge(fiscal)}</div><div class="sale-detail-grid"><section><h4>Itens</h4><div class="detail-items">${items.map(i=>`<div><span><b>${Number(i.quantity||0)}×</b> ${esc(i.name||i.description||i.sku||'Item')}</span><strong>${money(i.total??(Number(i.quantity||0)*Number(i.unit_price||0)-Number(i.discount||0)))}</strong></div>`).join('')||'<p>Nenhum item disponível.</p>'}</div></section><section><h4>Pagamento</h4><div class="detail-items">${payments.map(p=>`<div><span>${esc(paymentLabels[p.method]||p.method||'Forma')}</span><strong>${money(p.amount)}</strong></div>`).join('')||'<p>Sem pagamento sincronizado.</p>'}</div><h4>Fiscal</h4><div class="fiscal-meta"><span>Status: <b>${esc(fiscal?.status||'Não solicitado')}</b></span><span>Chave: <b>${esc(fiscal?.access_key||'—')}</b></span><span>Protocolo: <b>${esc(fiscal?.protocol||'—')}</b></span>${fiscalCode(fiscal)?`<span>cStat SEFAZ: <b>${esc(fiscalCode(fiscal))}</b></span>`:''}<span>Tentativas: <b>${Number(fiscal?.attempt_count||0)}</b></span></div>${fiscalDiagnosticHtml(fiscal)}<h4>Log da transmissão</h4>${fiscalTimelineHtml(fiscal)}</section></div><div class="sale-actions"><button class="secondary" id="reprintSale">Pré-venda</button><button class="secondary" id="nfceSale">${fiscal?.status==='authorized'?'Imprimir NFC-e':fiscal?.status==='transmission_error'?'Tentar envio novamente':'Solicitar NFC-e'}</button><button class="secondary warning-button" id="returnSale">Devolver</button><button class="danger primary" id="cancelSale">Cancelar venda</button></div>`,'wide');
  m.querySelector('#reprintSale').onclick=()=>safePrint(key,'pre_sale');
  m.querySelector('#nfceSale').onclick=()=>{m.remove();requestNfceAndMaybePrint(key);};
  m.querySelector('#returnSale').onclick=()=>{m.remove();returnSaleModal(detail);};
  m.querySelector('#cancelSale').onclick=()=>{m.remove();cancelSaleModal(detail);};
}

function cancelSaleModal'''
if 'Log da transmissão' not in s:
    s2,count=sale_detail_pattern.subn(new_sale_detail,s,count=1)
    if count!=1:raise SystemExit(f'desktop sale detail replacement failed {count}')
    s=s2

badge_pattern=re.compile(r'''function fiscalBadge\(fiscal\)\{.*?\}\nfunction saleStatusLabel''',re.S)
new_badge=r'''function fiscalBadge(fiscal){
  if(!fiscal)return '<span class="fiscal-status none">Não solicitada</span>';
  const status=String(fiscal.status||''),code=fiscalCode(fiscal);
  const labels={requested:'Solicitada',draft:'Rascunho',processing:'Processando',authorized:'Autorizada',rejected:'Rejeitada',transmission_error:'Falha no envio',cancelled:'Cancelada',contingency:'Contingência'};
  const live=status==='processing'?'<i class="fiscal-live-dot"></i> ':'';
  const suffix=(status==='rejected'&&code)?` ${esc(code)}`:'';
  return `<span class="fiscal-status fiscal-${esc(status)}">${live}${esc(labels[status]||status)}${suffix}</span>`;
}
function saleStatusLabel'''
if "transmission_error:'Falha no envio'" not in s:
    s2,count=badge_pattern.subn(new_badge,s,count=1)
    if count!=1:raise SystemExit(f'desktop badge replacement failed {count}')
    s=s2

p.write_text(s)

# ---- Desktop visual styles ----------------------------------------------------
p=Path('desktop-pdv/renderer/styles.css')
s=p.read_text()
marker='/* fiscal diagnostics v078 */'
css=r'''

/* fiscal diagnostics v078 */
.fiscal-processing{position:relative}.fiscal-transmission_error{background:#fff0f1;color:#a72e38}.fiscal-live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;margin-right:4px;animation:fiscalPulse 1s ease-in-out infinite}.fiscal-progress-head{display:flex;gap:15px;align-items:center;border-bottom:1px solid #edf0ee;padding-bottom:14px}.fiscal-progress-head small{font-size:10px;font-weight:900;letter-spacing:.12em;color:#19834b}.fiscal-progress-head h3{margin:3px 0 4px}.fiscal-progress-head p{margin:0;color:#68736d}.fiscal-spinner{width:42px;height:42px;border:4px solid #dce8e1;border-top-color:#19834b;border-radius:50%;animation:fiscalSpin .9s linear infinite;flex:0 0 auto}.fiscal-spinner.stopped{animation:none;border-color:#b7dcca;border-top-color:#19834b}.fiscal-progress-steps{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:18px 0}.fiscal-progress-step{display:grid;grid-template-columns:25px 1fr;align-items:center;gap:7px;padding:10px;border:1px solid #e5e9e6;border-radius:10px;color:#7a837e;font-size:11px;font-weight:800;background:#fafbfa}.fiscal-progress-step i{width:25px;height:25px;border:2px solid #d7ded9;border-radius:50%;display:grid;place-items:center;font-style:normal}.fiscal-progress-step.done{color:#176d41;background:#edf9f2;border-color:#bfe7cf}.fiscal-progress-step.done i{background:#19834b;color:#fff;border-color:#19834b}.fiscal-progress-step.active{border-color:#e7c680;background:#fff9ec;color:#875814}.fiscal-progress-step.active i{border-color:#d89a2f;animation:fiscalPulse 1s ease-in-out infinite}.fiscal-diagnostic{display:grid;gap:5px;border-radius:11px;padding:12px 14px;margin:12px 0;font-size:12px}.fiscal-diagnostic b{font-size:13px}.fiscal-diagnostic span{line-height:1.45}.fiscal-diagnostic code{display:block;margin-top:5px;padding:8px;border-radius:7px;background:#1111;white-space:pre-wrap;word-break:break-word}.fiscal-diagnostic.success{background:#eaf8f0;color:#176d41}.fiscal-diagnostic.error{background:#fff0f1;color:#9d2833}.fiscal-diagnostic.processing{background:#fff7e8;color:#85560d}.fiscal-diagnostic.warning{background:#fff7e8;color:#85560d}.fiscal-diagnostic.neutral{background:#f3f5f4;color:#68736d}.fiscal-progress-meta{display:flex;gap:12px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;background:#f8faf9;font-size:11px;word-break:break-all}.fiscal-event-list{display:grid;gap:8px;max-height:250px;overflow:auto;padding-right:4px}.fiscal-event{display:grid;grid-template-columns:12px 1fr;gap:8px;padding:9px 10px;border:1px solid #e7ebe8;border-radius:9px;background:#fff}.fiscal-event>i{width:9px;height:9px;border-radius:50%;background:#98a29d;margin-top:4px}.fiscal-event b,.fiscal-event small{display:block}.fiscal-event b{font-size:11px;color:#38413c}.fiscal-event small{font-size:10px;color:#85908a;margin-top:3px}.fiscal-event-success>i{background:#1f9f5b}.fiscal-event-warning>i{background:#d49a32}.fiscal-event-error>i{background:#d44d58}.fiscal-log-empty{padding:15px;border:1px dashed #dce2de;border-radius:9px;color:#85908a;text-align:center;font-size:11px}@keyframes fiscalSpin{to{transform:rotate(360deg)}}@keyframes fiscalPulse{0%,100%{opacity:.35;transform:scale(.82)}50%{opacity:1;transform:scale(1.12)}}@media(max-width:900px){.fiscal-progress-steps{grid-template-columns:1fr}.fiscal-progress-head{align-items:flex-start}}
'''
if marker not in s:s+=css
p.write_text(s)

# ---- Longer push timeout while SEFAZ is authorizing --------------------------
p=Path('desktop-pdv/agent/sync.js')
s=p.read_text()
old='''    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);'''
new='''    const controller=new AbortController();
    const timeoutMs=path==='/api/pdv/push'?45000:15000;
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);'''
if old in s:s=s.replace(old,new,1)
p.write_text(s)

# ---- Desktop version ----------------------------------------------------------
p=Path('desktop-pdv/package.json')
data=json.loads(p.read_text())
data['version']='0.7.4'
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
