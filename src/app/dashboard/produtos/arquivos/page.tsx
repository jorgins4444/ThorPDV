import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/product-files.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { productFileExportData } from '../../[...slug]/product-files-actions';
import { ProductFilesWorkspace } from '../../[...slug]/product-files-workspace';

export default async function ProductFilesPage(){
  const data=await productFileExportData();
  return <AdvancedShell
    title="Arquivos de Produtos"
    subtitle="Gere arquivos de preços para terminais de consulta e arquivos de produtos para balanças."
    activePath="/dashboard/produtos/arquivos"
    backHref="/dashboard/produtos"
    backLabel="Produtos"
  >
    <ProductFilesWorkspace initialData={data}/>
  </AdvancedShell>;
}
