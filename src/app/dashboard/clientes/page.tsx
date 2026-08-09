import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/management-shell.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { PartyWorkspace } from '../[...slug]/party-workspace';
import { partyList } from '../[...slug]/party-actions';

export default async function CustomersPage() {
  const result = await partyList('customers');
  return (
    <AdvancedShell
      title="Cadastro de Clientes"
      subtitle="CPF/CNPJ validado, endereço completo por CEP, nascimento e crédito em loja integrado ao ThorPDV."
      activePath="/dashboard/clientes"
    >
      <PartyWorkspace resource="customers" initial={result.data} />
    </AdvancedShell>
  );
}
