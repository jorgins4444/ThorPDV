import '../../../[...slug]/module.css';
import '../../../[...slug]/advanced.css';
import '../../../[...slug]/financial-accounts.css';
import '../../../[...slug]/bank-integrations.css';
import '../../../[...slug]/itau-sandbox-scenario.css';
import { AdvancedShell } from '../../../[...slug]/advanced-shell';
import { financialAccountsData } from '../../../[...slug]/financial-accounts-actions';
import { bankBillingsList, bankIntegrationsData } from '../../../[...slug]/bank-integrations-actions';
import { ItauBolecodeWorkspace } from '../../../[...slug]/itau-bolecode-workspace';

export default async function ItauBolecodePage(){
 const [accounts,integrations,billings]=await Promise.all([financialAccountsData(),bankIntegrationsData(),bankBillingsList(100)]);
 return <AdvancedShell title="Itaú BoleCode Pix" subtitle="Emissão de boleto registrado com QR Code Pix, homologação e acompanhamento da integração Itaú." activePath="/dashboard/financeiro/contas-bancarias" backHref="/dashboard/financeiro/contas-bancarias" backLabel="Voltar para Contas Bancárias">
  <ItauBolecodeWorkspace accountsInitial={accounts as Record<string,unknown>} integrationsInitial={integrations as Record<string,unknown>} billingsInitial={billings as Record<string,unknown>}/>
 </AdvancedShell>;
}
