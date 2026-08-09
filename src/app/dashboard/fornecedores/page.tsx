import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/management-shell.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { PartyWorkspace } from '../[...slug]/party-workspace';
import { partyList } from '../[...slug]/party-actions';

export default async function SuppliersPage() {
  const result = await partyList('suppliers');
  return (
    <AdvancedShell
      title="Cadastro de Fornecedores"
      subtitle="Pessoa física ou jurídica, CPF/CNPJ validado e endereço completo com consulta automática por CEP/CNPJ."
      activePath="/dashboard/fornecedores"
    >
      <PartyWorkspace resource="suppliers" initial={result.data} />
    </AdvancedShell>
  );
}
