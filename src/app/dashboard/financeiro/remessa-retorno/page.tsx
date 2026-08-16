import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-accounts.css';
import '../../[...slug]/bank-cnab.css';
import '../../[...slug]/bank-cnab-boleto-links.css';
import '../../[...slug]/bank-cnab-return-review.css';
import '../../[...slug]/bank-cnab-workspace-v2.css';
import '../../[...slug]/ui-visibility-fixes.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { cnabData } from '../../[...slug]/bank-cnab-actions';
import { BankCnabWorkspaceV2 } from '../../[...slug]/bank-cnab-workspace-v2';

export default async function RemessaRetornoPage(){
  const data=await cnabData();
  return <AdvancedShell title="Remessa / Retorno" subtitle="Gere remessas, confira retornos e acompanhe o histórico bancário em um fluxo mais simples." activePath="/dashboard/financeiro/remessa-retorno">
    <BankCnabWorkspaceV2 initial={data as Record<string,unknown>}/>
  </AdvancedShell>;
}
