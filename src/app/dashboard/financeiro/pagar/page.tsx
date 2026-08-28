import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/payables-v2.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { erpLoad } from '../../[...slug]/actions';
import { payablesFinancialContext, payablesList } from '../../[...slug]/payables-actions';
import { PayablesWorkspaceV2 } from '../../[...slug]/payables-workspace-v2';

export default async function PayablesPage(){
  const [payables,suppliers,context]=await Promise.all([
    payablesList(),
    erpLoad('suppliers'),
    payablesFinancialContext(),
  ]);

  return <AdvancedShell
    title="Contas a Pagar"
    subtitle="Obrigações de compras e despesas com baixa parcial/total integrada a contas bancárias, Caixa Interno e conciliação."
    activePath="/dashboard/financeiro/pagar"
  >
    <PayablesWorkspaceV2
      initial={payables.data}
      suppliers={suppliers.data}
      accounts={context.accounts}
      paymentMethods={context.payment_methods}
    />
  </AdvancedShell>;
}
