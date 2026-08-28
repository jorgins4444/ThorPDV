import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/payables-v2.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { erpLoad } from '../../[...slug]/actions';
import { payablesFinancialContext, payablesList } from '../../[...slug]/payables-actions';
import { financialStructureGet } from '../../[...slug]/financial-structure-actions';
import { PayablesWorkspaceV2 } from '../../[...slug]/payables-workspace-v2';

export default async function PayablesPage(){
  const [payables,suppliers,context,structure]=await Promise.all([
    payablesList(),
    erpLoad('suppliers'),
    payablesFinancialContext(),
    financialStructureGet(),
  ]);

  return <AdvancedShell
    title="Contas a Pagar"
    subtitle="Obrigações classificadas por categoria, conta gerencial e centro de custo, com baixa integrada a bancos e conciliação."
    activePath="/dashboard/financeiro/pagar"
  >
    <PayablesWorkspaceV2
      initial={payables.data}
      suppliers={suppliers.data}
      accounts={context.accounts}
      paymentMethods={context.payment_methods}
      categories={structure.categories}
      chartAccounts={structure.accounts}
      costCenters={structure.cost_centers}
    />
  </AdvancedShell>;
}
