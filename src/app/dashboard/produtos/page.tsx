import Link from 'next/link';
import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/product-master.css';
import '../[...slug]/product-studio.css';
import '../[...slug]/product-list-enhanced.css';
import '../[...slug]/product-list-columns.css';
import '../[...slug]/product-grade-gallery.css';
import '../[...slug]/product-main-image.css';
import '../[...slug]/product-studio-feedback.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { productStudioScreenBootstrap } from '../[...slug]/screen-bootstrap-actions';
import { ProductStudioWorkspace } from '../[...slug]/product-studio-workspace';
import { ProductListColumns } from '../[...slug]/product-list-columns';

export default async function ProductsPage(){
  const boot=await productStudioScreenBootstrap();
  return <>
    <AdvancedShell
      title="Cadastro de Produtos"
      subtitle="Produtos simples e com grade, preços, estoque, fiscal, imagens e configurações do ThorPDV em um único cadastro."
      activePath="/dashboard/produtos"
      backHref="/dashboard/produtos"
      backLabel="Produtos"
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
      <ProductListColumns/>
      <ProductStudioWorkspace
        initialProducts={boot.products}
        initialTotal={boot.total}
        groups={boot.groups}
        classes={boot.classes}
        suppliers={boot.suppliers}
        modifiers={boot.modifiers}
        branches={boot.branches}
        brands={boot.brands}
        categories={boot.categories}
      />
    </AdvancedShell>
    <script src="/product-image-upload-v091.js" defer />
  </>;
}
