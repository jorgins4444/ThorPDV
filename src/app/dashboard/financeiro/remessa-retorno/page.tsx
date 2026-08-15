import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-accounts.css';
import '../../[...slug]/bank-cnab.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { cnabData } from '../../[...slug]/bank-cnab-actions';
import { BankCnabMultiWorkspace } from '../../[...slug]/bank-cnab-multi-workspace';

export default async function RemessaRetornoPage(){
  const data=await cnabData();
  return <AdvancedShell title="Remessa / Retorno" subtitle="Cobrança registrada Itaú por CNAB 240 ou CNAB 400, com baixa automática pelo retorno bancário." activePath="/dashboard/financeiro/remessa-retorno">
    <BankCnabMultiWorkspace initial={data as Record<string,unknown>}/>
  </AdvancedShell>;
}
