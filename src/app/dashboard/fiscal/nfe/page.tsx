import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/fiscal.css';
import '../../[...slug]/fiscal-configuration.css';
import '../../[...slug]/fiscal-documents.css';
import '../../[...slug]/nfe-emission.css';
import '../../[...slug]/fiscal-center.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { NfeEmissionWorkspace } from '../../[...slug]/nfe-emission-workspace';
import { nfeScreenBootstrap } from '../../[...slug]/screen-bootstrap-actions';

export default async function NfePage(){
  const boot=await nfeScreenBootstrap();
  return <AdvancedShell title="Emissão de NF-e" subtitle="NF-e modelo 55 por venda ou preenchimento manual, com validação fiscal, série, destinatário, itens e acompanhamento." activePath="/dashboard/fiscal/nfe" backHref="/dashboard/fiscal" backLabel="Fiscal"><NfeEmissionWorkspace documents={boot.documents} sales={boot.sales} customers={boot.customers} products={boot.products} settings={boot.settings}/></AdvancedShell>;
}
