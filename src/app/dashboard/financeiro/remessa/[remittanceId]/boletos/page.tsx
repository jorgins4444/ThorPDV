import '../../../../[...slug]/module.css';
import '../../../../[...slug]/advanced.css';
import '../../../../[...slug]/bank-cnab.css';
import '../../../../[...slug]/bank-cnab-boleto-links.css';
import { AdvancedShell } from '../../../../[...slug]/advanced-shell';
import { cnabRemittanceBoletoItems } from '../../../../[...slug]/bank-cnab-actions';

type Row=Record<string,unknown>;
type Props={params:Promise<{remittanceId:string}>};
const text=(v:unknown)=>v==null?'':String(v);
const money=(v:unknown)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';

export default async function RemittanceBoletosPage({params}:Props){
  const {remittanceId}=await params;
  const data=await cnabRemittanceBoletoItems(remittanceId);
  const remittance=(data.remittance as Row)||{};
  const items=Array.isArray(data.items)?data.items as Row[]:[];
  return <AdvancedShell title="Boletos da Remessa" subtitle="Impressão dos boletos com os mesmos dados bancários gravados no arquivo de remessa." activePath="/dashboard/financeiro/remessa-retorno" backHref="/dashboard/financeiro/remessa-retorno" backLabel="Remessa / Retorno">
    <div className="cnab-studio">
      {!data.ok?<section className="cnab-panel"><header><div><span>REMESSA</span><h2>Não foi possível carregar os boletos</h2><p>{text(data.error)||'Remessa não encontrada.'}</p></div></header></section>:<>
        <section className="cnab-hero"><div><span>IMPRESSÃO DE BOLETOS</span><h1>{text(remittance.file_name)||'Remessa bancária'}</h1><p>Cada boleto usa o Nosso Número, linha digitável e código de barras persistidos no item enviado ao banco.</p></div><div className="cnab-hero-badge"><b>{items.length}</b><span>boleto(s) · {money(remittance.total_amount)}</span></div></section>
        <section className="cnab-panel"><header><div><span>TÍTULOS DA REMESSA</span><h2>Selecione para visualizar ou imprimir</h2><p>A impressão abre em uma página A4 dedicada, sem menus do Thor.</p></div></header><div className="cnab-table"><table><thead><tr><th>Cliente</th><th>Documento</th><th>Nosso Número</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>{items.length===0?<tr><td colSpan={7} className="empty">Nenhum boleto vinculado a esta remessa.</td></tr>:items.map(i=><tr key={text(i.id)}><td><b>{text(i.customer)||'—'}</b><small>{text(i.customer_document)||''}</small></td><td>{text(i.document_number)}</td><td>{text(i.our_number)}-{text(i.our_number_dac)}</td><td>{date(i.due_date)}</td><td><b>{money(i.amount)}</b></td><td><span className={`tag ${text(i.status)}`}>{text(i.status)}</span></td><td><a className="primary-link" target="_blank" rel="noreferrer" href={`/dashboard/financeiro/boleto/${text(i.id)}`}>Visualizar / Imprimir</a></td></tr>)}</tbody></table></div></section>
      </>}
    </div>
  </AdvancedShell>;
}
