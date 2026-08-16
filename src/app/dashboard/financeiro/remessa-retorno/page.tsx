import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-accounts.css';
import '../../[...slug]/bank-cnab.css';
import '../../[...slug]/bank-cnab-boleto-links.css';
import '../../[...slug]/bank-cnab-return-review.css';
import '../../[...slug]/ui-visibility-fixes.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { cnabData } from '../../[...slug]/bank-cnab-actions';
import { BankCnabReviewedWorkspace } from '../../[...slug]/bank-cnab-reviewed-workspace';

export default async function RemessaRetornoPage(){
  const data=await cnabData();
  return <AdvancedShell title="Remessa / Retorno" subtitle="Cobrança registrada Itaú por CNAB 240 ou CNAB 400, com conferência dos boletos antes da baixa financeira." activePath="/dashboard/financeiro/remessa-retorno">
    <BankCnabReviewedWorkspace initial={data as Record<string,unknown>}/>
  </AdvancedShell>;
}
