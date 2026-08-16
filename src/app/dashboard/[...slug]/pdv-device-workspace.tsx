'use client';

import { useMemo, useState, useTransition } from 'react';
import { pdvDeviceList, pdvGenerateEnrollment, pdvReconnectDevice, pdvSetDeviceStatus } from './pdv-device-actions';

type Row = Record<string, unknown>;

function text(value: unknown) { return value == null ? '' : String(value); }
function num(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function when(value: unknown) { if (!value) return 'Nunca'; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('pt-BR'); }
function healthLabel(value: unknown) { const v=text(value); return v==='healthy'?'Saudável':v==='warning'?'Atenção':v==='blocked'?'Bloqueado':v==='reconnect_required'?'Reconexão pendente':'Offline'; }

export function PdvDeviceWorkspace({ posRegisters, initialDevices }: { posRegisters: Row[]; initialDevices: Row[] }) {
  const [devices, setDevices] = useState(initialDevices);
  const [posId, setPosId] = useState(text(posRegisters[0]?.id));
  const [label, setLabel] = useState('Caixa principal');
  const [enrollment, setEnrollment] = useState<{ code?: string; expires_at?: string; pos_name?: string; reconnect?: boolean } | null>(null);
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const online = useMemo(() => devices.filter((d) => text(d.status) === 'online').length, [devices]);
  const withPending = useMemo(() => devices.filter((d) => num(d.queue_pending) > 0 || num(d.queue_rejected) > 0).length, [devices]);

  const refresh = () => startTransition(async () => {
    const result = await pdvDeviceList();
    if (result.ok) setDevices(result.data);
  });

  const generate = () => startTransition(async () => {
    if (!posId) return setMessage('Cadastre ou selecione um caixa/PDV antes de gerar a ativação.');
    setMessage('');
    const result = await pdvGenerateEnrollment(posId, label);
    if (!result.ok) return setMessage(text(result.error || 'Não foi possível gerar o código.'));
    setEnrollment({ code: text(result.code), expires_at: text(result.expires_at), pos_name: text(result.pos_name) });
  });

  const reconnect = (id: string) => startTransition(async () => {
    if (!window.confirm('Refazer a conexão deste terminal? O ThorPDV será marcado para reconexão e pedirá automaticamente o novo código. As vendas locais permanecem preservadas.')) return;
    setMessage('');
    const result = await pdvReconnectDevice(id);
    if (!result.ok) return setMessage(text(result.error || 'Não foi possível preparar a reconexão.'));
    setEnrollment({ code: text(result.code), expires_at: text(result.expires_at), pos_name: text(result.pos_name), reconnect: true });
    setMessage('Reconexão preparada. O ThorPDV compatível detectará a alteração automaticamente e abrirá a tela para informar este novo código. Não é necessário apagar vendas ou a base local.');
    await refresh();
  });

  const setStatus = (id: string, status: 'offline'|'blocked') => startTransition(async () => {
    const result = await pdvSetDeviceStatus(id, status);
    if (!result.ok) setMessage(text(result.error || 'Não foi possível alterar o terminal.'));
    await refresh();
  });

  return <div className="pdv-device-grid">
    <section className="pdv-device-card pdv-device-activate">
      <div className="pdv-device-title"><div><span className="pdv-device-kicker">Pareamento seguro</span><h2>{enrollment?.reconnect?'Reconectar ThorPDV Desktop':'Ativar ThorPDV Desktop'}</h2><p>Gere um código de uso único e informe no computador Windows que ficará no caixa.</p></div><div className="pdv-device-badge">SYNC v3</div></div>
      <div className="pdv-device-form">
        <label><span>Caixa / PDV</span><select value={posId} onChange={(e)=>setPosId(e.target.value)}>{posRegisters.map((p)=><option key={text(p.id)} value={text(p.id)}>{text(p.name) || text(p.code) || 'PDV'}</option>)}</select></label>
        <label><span>Identificação</span><input value={label} onChange={(e)=>setLabel(e.target.value)} placeholder="Ex.: Caixa 01 - Balcão" /></label>
        <button type="button" className="pdv-device-primary" onClick={generate} disabled={pending}>{pending?'Gerando...':'Gerar código de ativação'}</button>
      </div>
      {enrollment?.code ? <div className="pdv-enrollment-code"><small>{enrollment.reconnect?'Novo código de reconexão':'Código de ativação'}</small><strong>{enrollment.code}</strong><p>Expira em {when(enrollment.expires_at)} e só pode ser usado uma vez.</p></div> : null}
      {message ? <div className="pdv-device-message">{message}</div> : null}
      <div className="pdv-device-flow"><span>1. Parear</span><b>→</b><span>2. Baixar catálogo</span><b>→</b><span>3. Vender offline/online</span><b>→</b><span>4. Subir vendas/estoque</span></div>
    </section>

    <section className="pdv-device-card">
      <div className="pdv-device-title"><div><span className="pdv-device-kicker">Monitoramento</span><h2>Terminais conectados</h2><p>{devices.length} terminal(is), {online} online e {withPending} com fila local pendente/erro.</p></div><button type="button" className="pdv-device-secondary" onClick={refresh} disabled={pending}>Atualizar</button></div>
      <div className="pdv-device-table-wrap"><table className="pdv-device-table"><thead><tr><th>Terminal</th><th>PDV / Filial</th><th>Saúde</th><th>Fila local</th><th>Última atividade</th><th>Ações</th></tr></thead><tbody>
        {devices.length===0 ? <tr><td colSpan={6}><div className="pdv-device-empty">Nenhum ThorPDV Desktop foi ativado ainda.</div></td></tr> : devices.map((d)=><tr key={text(d.id)}>
          <td><strong>{text(d.name)}</strong><small>{text(d.hostname) || text(d.machine_id)} • v{text(d.app_version) || '—'}</small></td>
          <td><strong>{text(d.pos_name)}</strong><small>{text(d.branch_name)}</small></td>
          <td><span className={`pdv-status pdv-${text(d.sync_health)||text(d.status)}`}>{healthLabel(d.sync_health||d.status)}</span><small>{text(d.status)==='online'?'Terminal conectado':text(d.status)==='reconnect_required'?'Aguardando novo pareamento':`Último contato: ${when(d.last_seen_at)}`}</small></td>
          <td><strong>↑ {num(d.queue_pending)} pendente(s)</strong><small>{num(d.queue_rejected)>0?`⚠ ${num(d.queue_rejected)} com erro`:`✓ ${num(d.queue_synced)} sincronizado(s)`}</small>{d.last_sync_error?<small className="pdv-sync-error">{text(d.last_sync_error)}</small>:null}</td>
          <td><strong>Venda: {when(d.last_sale_sync_at)}</strong><small>Push: {when(d.last_push_at)} • Pull: {when(d.last_pull_at)}</small></td>
          <td><div className="pdv-device-actions"><button type="button" className="pdv-device-link" onClick={()=>reconnect(text(d.id))}>Refazer conexão</button><button type="button" className="pdv-device-link" onClick={()=>setStatus(text(d.id), text(d.status)==='blocked'?'offline':'blocked')}>{text(d.status)==='blocked'?'Desbloquear':'Bloquear'}</button></div></td>
        </tr>)}
      </tbody></table></div>
    </section>

    <section className="pdv-device-card pdv-device-info">
      <h3>Sincronização bidirecional e offline</h3>
      <div className="pdv-sync-capabilities"><div><b>↓ Gestão → PDV</b><span>Produtos, códigos, preços, promoções, clientes, estoque, usuários e permissões.</span></div><div><b>↑ PDV → Gestão</b><span>Vendas, itens, pagamentos, caixa, devoluções, cancelamentos e dados que movimentam estoque/financeiro.</span></div><div><b>Consistência offline</b><span>O saldo local preserva o impacto de vendas ainda pendentes mesmo durante novos downloads do Gestão.</span></div><div><b>Retentativa inteligente</b><span>Timeout e backoff exponencial reduzem falhas em redes instáveis e evitam excesso de chamadas.</span></div></div>
    </section>
  </div>;
}
