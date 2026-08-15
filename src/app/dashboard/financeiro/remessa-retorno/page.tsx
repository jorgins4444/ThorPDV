import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-accounts.css';
import '../../[...slug]/bank-cnab.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { cnab400Data } from '../../[...slug]/bank-cnab-actions';
import { BankCnabWorkspace } from '../../[...slug]/bank-cnab-workspace';

export default async function RemessaRetornoPage(){
  const data=await cnab400Data();
  return <AdvancedShell title="Remessa / Retorno" subtitle="Cobrança registrada Itaú por arquivo CNAB 400, com baixa automática pelo retorno bancário." activePath="/dashboard/financeiro/remessa-retorno">
    <BankCnabWorkspace initial={data as Record<string,unknown>}/>
  </AdvancedShell>;
}
