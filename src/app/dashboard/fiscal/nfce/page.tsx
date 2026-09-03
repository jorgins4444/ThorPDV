import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/fiscal.css';
import '../../[...slug]/fiscal-documents.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { FiscalDocumentsWorkspace } from '../../[...slug]/fiscal-documents-workspace';
import { fiscalDocumentsScreenBootstrap } from '../../[...slug]/screen-bootstrap-actions';

export default async function NfcePage(){
  const boot=await fiscalDocumentsScreenBootstrap();
  return <AdvancedShell title="Documentos Fiscais" subtitle="Emissão e acompanhamento de NF-e e NFC-e, status SEFAZ, protocolos, XML, DANFE e cancelamentos." activePath="/dashboard/documentos-fiscais"><FiscalDocumentsWorkspace initialDocs={boot.documents} sales={boot.sales} settings={boot.settings} initialType="nfce"/></AdvancedShell>;
}
