import Link from 'next/link';
import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/management-shell.css';
import './expiry-lots.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { expiryLotsLoad, expiryLotTrace } from './actions';
import { ExpiryLotsWorkspace } from './expiry-lots-workspace';

export default async function ExpiryLotsPage(){
 const [initial,traces]=await Promise.all([expiryLotsLoad(),expiryLotTrace()]);
 return <AdvancedShell title="Lotes e Validades" subtitle="Controle de vencimento por produto, lote e filial." activePath="/dashboard/estoque/validades">
  <div className="lot-actions-top"><Link href="/dashboard/estoque" className="erp-ghost">← Gestão de Estoque</Link></div>
  <ExpiryLotsWorkspace initial={initial} initialTraces={traces.traces??[]}/>
 </AdvancedShell>;
}
