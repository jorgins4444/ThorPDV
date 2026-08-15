import Link from 'next/link';
import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/product-master.css';
import '../[...slug]/product-studio.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { erpLoad } from '../[...slug]/actions';
import { productStudioList } from '../[...slug]/product-studio-actions';
import { ProductStudioWorkspace } from '../[...slug]/product-studio-workspace';

export default async function ProductsPage(){
  const [products,groups,classes,suppliers,modifiers,branches]=await Promise.all([
    productStudioList(),erpLoad('groups'),erpLoad('classes'),erpLoad('suppliers'),erpLoad('modifiers'),erpLoad('branches'),
  ]);
  return <AdvancedShell
    title="Cadastro de Produtos"
    subtitle="Produtos simples e com grade, preços, estoque, fiscal, imagens e configurações do ThorPDV em um único cadastro."
    activePath="/dashboard/produtos"
  >
    <nav className="studio-catalog-nav" aria-label="Cadastros de produtos">
      <Link href="/dashboard/produtos/marcas">Marcas</Link>
      <Link href="/dashboard/produtos/categorias">Categorias</Link>
      <Link href="/dashboard/produtos/atributos">Atributos</Link>
      <Link href="/dashboard/produtos/unidades">Unidades de Medida</Link>
      <Link href="/dashboard/produtos/arquivos">Arquivos</Link>
      <Link href="/dashboard/grupos">Grupos</Link>
      <Link href="/dashboard/classes">Classes</Link>
      <Link href="/dashboard/modificadores">Modificadores</Link>
    </nav>
    <ProductStudioWorkspace
      initialProducts={products.data}
      groups={groups.data}
      classes={classes.data}
      suppliers={suppliers.data}
      modifiers={modifiers.data}
      branches={branches.data}
    />
  </AdvancedShell>;
}
