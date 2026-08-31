from pathlib import Path

path=Path("src/app/dashboard/[...slug]/nfe-emission-workspace.tsx")
text=path.read_text(encoding="utf-8")

def rep(old,new):
    global text
    if old not in text:
        raise SystemExit(f"pattern not found:\n{old[:260]}")
    text=text.replace(old,new)

rep("import { fiscalCfopRulesGet, fiscalPrepareV2, nfeManualDraftCreate } from './fiscal-config-actions';", "import { fiscalCfopRulesGet, nfeManualDraftCreate, nfeSaleDraftCreate } from './fiscal-config-actions';")
rep("    const result = await fiscalPrepareV2(saleId, 'nfe', saleSeriesId || undefined);", "    const result = await nfeSaleDraftCreate(saleId, saleSeriesId || undefined, { nature_operation: natureOperation.trim() || 'VENDA DE MERCADORIA', purpose, presence, consumer_final: consumerFinal });")
old="""          <label className=\"wide\">Venda concluída<select value={saleId} onChange={(e) => setSaleId(e.target.value)}><option value=\"\">Selecione...</option>{completedSales.map((sale) => <option key={txt(sale.id)} value={txt(sale.id)}>Venda #{txt(sale.number || sale.sale_number)} · {txt(sale.customer || sale.customer_name || 'Consumidor')} · {money(sale.total)}</option>)}</select></label>
          <label>Série<select value={saleSeriesId} onChange={(e) => setSaleSeriesId(e.target.value)}><option value=\"\">Série padrão</option>{nfeSeries.map((row) => <option key={txt(row.id)} value={txt(row.id)}>Série {txt(row.series)}{row.is_default ? ' · padrão' : ''}</option>)}</select></label>
          <div className=\"nfe-action-box\"><button className=\"nfe-primary\" disabled={busy || !saleId || !operationalReady} onClick={() => void createFromSale()}>{busy ? 'Preparando...' : 'Validar e criar rascunho'}</button><small>A numeração só é consumida depois das validações fiscais.</small></div>"""
new="""          <label className=\"wide\">Venda concluída<select value={saleId} onChange={(e) => setSaleId(e.target.value)}><option value=\"\">Selecione...</option>{completedSales.map((sale) => <option key={txt(sale.id)} value={txt(sale.id)}>Venda #{txt(sale.number || sale.sale_number)} · {txt(sale.customer || sale.customer_name || 'Consumidor')} · {money(sale.total)}</option>)}</select></label>
          <label>Finalidade<select value={purpose} onChange={(e) => setPurpose(e.target.value)}><option value=\"1\">Normal</option><option value=\"2\">Complementar</option><option value=\"3\">Ajuste</option><option value=\"4\">Devolução / Retorno</option></select></label>
          <label>Presença<select value={presence} onChange={(e) => setPresence(e.target.value)}><option value=\"0\">Não se aplica</option><option value=\"1\">Presencial</option><option value=\"2\">Não presencial · Internet</option><option value=\"3\">Não presencial · Teleatendimento</option><option value=\"5\">Presencial · fora do estabelecimento</option><option value=\"9\">Não presencial · outros</option></select></label>
          <label>Série<select value={saleSeriesId} onChange={(e) => setSaleSeriesId(e.target.value)}><option value=\"\">Série padrão</option>{nfeSeries.map((row) => <option key={txt(row.id)} value={txt(row.id)}>Série {txt(row.series)}{row.is_default ? ' · padrão' : ''}</option>)}</select></label>
          <label className=\"nfe-check\"><input type=\"checkbox\" checked={consumerFinal} onChange={(e) => setConsumerFinal(e.target.checked)} /><span>Consumidor final</span></label>
          <div className=\"nfe-action-box wide\"><button className=\"nfe-primary\" disabled={busy || !saleId || !operationalReady} onClick={() => void createFromSale()}>{busy ? 'Preparando...' : 'Validar CFOPs e criar rascunho'}</button><small>O Thor compara a UF do cliente com a UF do emitente, aplica as regras de CFOP por item e só depois reserva a numeração.</small></div>"""
rep(old,new)
path.write_text(text,encoding="utf-8")
