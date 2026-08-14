import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-accounts.css';
import '../../[...slug]/bank-integrations.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { financialAccountsData } from '../../[...slug]/financial-accounts-actions';
import { FinancialAccountsWorkspace } from '../../[...slug]/financial-accounts-workspace';

export default async function FinancialAccountsPage(){const data=await financialAccountsData();return <AdvancedShell title="Contas Bancárias" subtitle="Caixa Interno, contas bancárias, transferências, lançamentos e base para conciliação financeira." activePath="/dashboard/financeiro/contas-bancarias">
  <a className="bank-integration-banner" href="/dashboard/financeiro/contas-bancarias/itau"><div><small>NOVO · INTEGRAÇÕES BANCÁRIAS</small><strong>Itaú BoleCode Pix</strong><span>Configure uma conta Itaú e homologue boleto registrado + QR Code Pix diretamente no Thor.</span></div><b>Configurar Itaú →</b></a>
  <FinancialAccountsWorkspace initial={data}/>
 </AdvancedShell>}
