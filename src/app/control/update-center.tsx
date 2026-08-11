'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  controlReleaseSave,
  controlUpdateDashboard,
  controlUpdatePolicyClear,
  controlUpdatePolicySet,
} from './actions';

type Row = Record<string, unknown>;
type UpdateData = {
  summary: Row;
  releases: Row[];
  tenants: Row[];
  policies: Row[];
  devices: Row[];
  events: Row[];
};

const empty: UpdateData = { summary: {}, releases: [], tenants: [], policies: [], devices: [], events: [] };
const text = (v: unknown) => String(v ?? '');
const dt = (v: unknown) => v ? new Date(String(v)).toLocaleString('pt-BR') : '—';

export default function UpdateCenter() {
  const [data, setData] = useState<UpdateData>(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [releaseForm, setReleaseForm] = useState({ version: '', channel: 'stable', status: 'published', download_url: '', sha256: '', release_notes: '' });
  const [policy, setPolicy] = useState({ scope: 'global', tenant_id: '', device_id: '', release_id: '', mode: 'notify', reason: '' });

  async function load() {
    const result = await controlUpdateDashboard();
    if (!result?.ok) { setMessage(result?.error || 'Não foi possível carregar o Update Center.'); return; }
    setData({
      summary: result.summary || {}, releases: result.releases || [], tenants: result.tenants || [],
      policies: result.policies || [], devices: result.devices || [], events: result.events || [],
    });
  }

  useEffect(() => { void load(); }, []);

  const published = useMemo(() => data.releases.filter(r => text(r.status) === 'published'), [data.releases]);
  const selectedRelease = published.find(r => text(r.id) === policy.release_id);
  const globalTarget = text(data.summary.global_target_version) || 'Nenhuma';

  async function saveRelease(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await controlReleaseSave(releaseForm);
      if (!result?.ok) throw new Error(result?.error || 'release_save_failed');
      setMessage(`Versão ${releaseForm.version} cadastrada.`);
      setReleaseForm({ version: '', channel: 'stable', status: 'published', download_url: '', sha256: '', release_notes: '' });
      await load();
    } catch (err) { setMessage(String((err as Error).message || err)); }
    finally { setBusy(false); }
  }

  async function applyPolicy() {
    if (!policy.release_id) { setMessage('Escolha a versão-alvo.'); return; }
    if (policy.scope === 'tenant' && !policy.tenant_id) { setMessage('Escolha o cliente.'); return; }
    if (policy.scope === 'device' && !policy.device_id) { setMessage('Escolha o PDV.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await controlUpdatePolicySet(policy);
      if (!result?.ok) throw new Error(result?.error || 'policy_save_failed');
      setMessage(`Versão ${text(selectedRelease?.version)} liberada para ${policy.scope === 'global' ? 'todos os clientes' : policy.scope === 'tenant' ? 'o cliente selecionado' : 'o PDV selecionado'}.`);
      await load();
    } catch (err) { setMessage(String((err as Error).message || err)); }
    finally { setBusy(false); }
  }

  async function clearPolicy() {
    setBusy(true); setMessage('');
    try {
      const result = await controlUpdatePolicyClear(policy);
      if (!result?.ok) throw new Error(result?.error || 'policy_clear_failed');
      setMessage('Política removida. O destino volta a herdar a política de nível superior.');
      await load();
    } catch (err) { setMessage(String((err as Error).message || err)); }
    finally { setBusy(false); }
  }

  async function changeReleaseStatus(r: Row, status: string) {
    setBusy(true); setMessage('');
    try {
      const result = await controlReleaseSave({ ...r, status });
      if (!result?.ok) throw new Error(result?.error || 'release_status_failed');
      setMessage(`Versão ${text(r.version)} marcada como ${status}.`);
      await load();
    } catch (err) { setMessage(String((err as Error).message || err)); }
    finally { setBusy(false); }
  }

  return <div className="update-center">
    <div className="control-summary-grid update-summary">
      <article><span>Versão global alvo</span><strong>{globalTarget}</strong><small>Somente versões explicitamente liberadas</small></article>
      <article><span>PDVs cadastrados</span><strong>{text(data.summary.total_devices || 0)}</strong><small>Versão reportada pelo heartbeat</small></article>
      <article><span>Atualizações pendentes</span><strong>{text(data.summary.pending_devices || 0)}</strong><small>Inclui upgrade e rollback</small></article>
      <article><span>Releases publicadas</span><strong>{text(data.summary.published_releases || 0)}</strong><small>Disponíveis para políticas</small></article>
    </div>

    {message && <div className="control-inline-message">{message}</div>}

    <section className="control-panel update-policy-panel">
      <div className="control-panel-title"><div><small>ROLLOUT</small><h2>Liberação e rollback</h2><p>A prioridade é PDV específico → cliente → global. Selecionar uma versão anterior cria um rollback controlado.</p></div></div>
      <div className="update-policy-grid">
        <label><span>Destino</span><select value={policy.scope} onChange={e => setPolicy(p => ({ ...p, scope: e.target.value, tenant_id: '', device_id: '' }))}><option value="global">Todos os clientes</option><option value="tenant">Cliente específico</option><option value="device">PDV específico</option></select></label>
        {policy.scope === 'tenant' && <label><span>Cliente</span><select value={policy.tenant_id} onChange={e => setPolicy(p => ({ ...p, tenant_id: e.target.value }))}><option value="">Selecione...</option>{data.tenants.map(t => <option key={text(t.id)} value={text(t.id)}>{text(t.name)}</option>)}</select></label>}
        {policy.scope === 'device' && <label><span>PDV</span><select value={policy.device_id} onChange={e => setPolicy(p => ({ ...p, device_id: e.target.value }))}><option value="">Selecione...</option>{data.devices.map(d => <option key={text(d.id)} value={text(d.id)}>{text(d.tenant_name)} · {text(d.device_name)} · v{text(d.app_version || '?')}</option>)}</select></label>}
        <label><span>Versão-alvo</span><select value={policy.release_id} onChange={e => setPolicy(p => ({ ...p, release_id: e.target.value }))}><option value="">Selecione...</option>{published.map(r => <option key={text(r.id)} value={text(r.id)}>v{text(r.version)} · {text(r.channel)}</option>)}</select></label>
        <label><span>Modo</span><select value={policy.mode} onChange={e => setPolicy(p => ({ ...p, mode: e.target.value }))}><option value="notify">Disponível para instalar</option><option value="mandatory">Obrigatória / prioritária</option></select></label>
        <label className="update-policy-reason"><span>Motivo / observação</span><input value={policy.reason} onChange={e => setPolicy(p => ({ ...p, reason: e.target.value }))} placeholder="Ex.: correção fiscal, piloto, rollback por bug..." /></label>
      </div>
      <div className="control-actions"><button disabled={busy} onClick={applyPolicy}>{busy ? 'Aplicando...' : 'Aplicar versão-alvo'}</button><button className="ghost" disabled={busy} onClick={clearPolicy}>Remover política deste nível</button></div>
      <div className="update-warning"><strong>Rollback seguro:</strong> reverte o executável do ThorPDV, não desfaz migrations do banco. Releases precisam manter contratos de banco compatíveis com versões anteriores.</div>
    </section>

    <section className="control-panel">
      <div className="control-panel-title"><div><small>RELEASES</small><h2>Cadastrar versão</h2><p>O ThorPDV só instala pacotes HTTPS cujo SHA-256 seja idêntico ao cadastrado.</p></div></div>
      <form className="update-release-form" onSubmit={saveRelease}>
        <label><span>Versão</span><input required pattern="[0-9]+\.[0-9]+\.[0-9]+" placeholder="0.8.1" value={releaseForm.version} onChange={e => setReleaseForm(f => ({ ...f, version: e.target.value }))} /></label>
        <label><span>Canal</span><select value={releaseForm.channel} onChange={e => setReleaseForm(f => ({ ...f, channel: e.target.value }))}><option value="stable">Estável</option><option value="pilot">Piloto</option></select></label>
        <label><span>Status</span><select value={releaseForm.status} onChange={e => setReleaseForm(f => ({ ...f, status: e.target.value }))}><option value="published">Publicada</option><option value="draft">Rascunho</option></select></label>
        <label className="wide"><span>URL HTTPS do instalador</span><input required type="url" placeholder="https://github.com/.../ThorPDV-Desktop-0.8.1-x64.exe" value={releaseForm.download_url} onChange={e => setReleaseForm(f => ({ ...f, download_url: e.target.value }))} /></label>
        <label className="wide"><span>SHA-256</span><input required minLength={64} maxLength={64} placeholder="64 caracteres hexadecimais" value={releaseForm.sha256} onChange={e => setReleaseForm(f => ({ ...f, sha256: e.target.value.toLowerCase() }))} /></label>
        <label className="wide"><span>Notas da versão</span><textarea rows={3} value={releaseForm.release_notes} onChange={e => setReleaseForm(f => ({ ...f, release_notes: e.target.value }))} placeholder="Correções e novidades mostradas no PDV." /></label>
        <div className="control-actions wide"><button type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Cadastrar versão'}</button></div>
      </form>
    </section>

    <section className="control-panel">
      <div className="control-panel-title"><div><small>VERSÕES</small><h2>Releases disponíveis</h2></div></div>
      <div className="control-table-wrap"><table><thead><tr><th>Versão</th><th>Canal</th><th>Status</th><th>SHA-256</th><th>Publicada</th><th>Ações</th></tr></thead><tbody>{data.releases.map(r => <tr key={text(r.id)}><td><strong>v{text(r.version)}</strong><small>{text(r.release_notes)}</small></td><td>{text(r.channel)}</td><td><span className={`control-badge ${text(r.status)}`}>{text(r.status)}</span></td><td><code>{text(r.sha256).slice(0, 12)}…</code></td><td>{dt(r.published_at)}</td><td className="update-row-actions">{text(r.status) !== 'published' && <button onClick={() => changeReleaseStatus(r, 'published')}>Publicar</button>}{text(r.status) === 'published' && <button className="danger-link" onClick={() => changeReleaseStatus(r, 'blocked')}>Bloquear</button>}{text(r.status) !== 'archived' && <button className="ghost-link" onClick={() => changeReleaseStatus(r, 'archived')}>Arquivar</button>}</td></tr>)}</tbody></table></div>
    </section>

    <section className="control-panel">
      <div className="control-panel-title"><div><small>FROTA</small><h2>Versões instaladas nos clientes</h2><p>O alvo exibido já considera a política específica, do cliente e global.</p></div></div>
      <div className="control-table-wrap"><table><thead><tr><th>Cliente / PDV</th><th>Instalada</th><th>Alvo</th><th>Situação</th><th>Último contato</th></tr></thead><tbody>{data.devices.map(d => <tr key={text(d.id)}><td><strong>{text(d.tenant_name)}</strong><small>{text(d.device_name)} · {text(d.branch_name)} · {text(d.pos_name)}</small></td><td>v{text(d.app_version || '?')}</td><td>{d.target_version ? `v${text(d.target_version)}` : 'Herdando / sem alvo'}</td><td><span className={`update-state ${text(d.update_state)}`}>{text(d.update_state) === 'current' ? 'Atualizado' : text(d.update_state) === 'rollback' ? 'Rollback pendente' : text(d.update_state) === 'upgrade' ? 'Atualização pendente' : 'Sem política'}</span></td><td>{dt(d.last_seen_at)}</td></tr>)}</tbody></table></div>
    </section>

    <section className="control-panel">
      <div className="control-panel-title"><div><small>AUDITORIA</small><h2>Histórico de atualização</h2></div></div>
      <div className="control-table-wrap"><table><thead><tr><th>Data</th><th>Cliente / PDV</th><th>Evento</th><th>Versão</th><th>Detalhes</th></tr></thead><tbody>{data.events.slice(0, 40).map(e => <tr key={text(e.id)}><td>{dt(e.created_at)}</td><td><strong>{text(e.tenant_name)}</strong><small>{text(e.device_name)}</small></td><td>{text(e.event_type)}</td><td>{text(e.from_version || '?')} → {text(e.to_version || '?')}</td><td><code>{JSON.stringify(e.details || {})}</code></td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
