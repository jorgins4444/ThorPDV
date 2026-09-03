import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/product-workspace.css';
import '../../[...slug]/product-master.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { ProductMasterWorkspace } from '../../[...slug]/product-master-workspace';
import { productScreenBootstrap } from '../../[...slug]/screen-bootstrap-actions';

export default async function NewProductPage(){
  const boot=await productScreenBootstrap();
  return <AdvancedShell title="Cadastro de Produtos" subtitle="Cadastro completo integrado a preços, tributação, estoque, ficha técnica, produção, balança e PDV." activePath="/dashboard/produtos">
    <ProductMasterWorkspace initialProducts={boot.products} groups={boot.groups} classes={boot.classes} suppliers={boot.suppliers} modifiers={boot.modifiers} branches={boot.branches}/>
  </AdvancedShell>;
}
