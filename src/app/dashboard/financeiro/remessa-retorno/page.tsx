import '../../[...slug]/financial-accounts.css';
import '../../[...slug]/bank-cnab.css';
import { cnab400Data } from '../../[...slug]/bank-cnab-actions';
import { BankCnabWorkspace } from '../../[...slug]/bank-cnab-workspace';

export default async function RemessaRetornoPage(){
  const data=await cnab400Data();
  return <BankCnabWorkspace initial={data as Record<string,unknown>}/>;
}
