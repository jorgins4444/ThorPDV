import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/product-reference.css';
import { notFound } from 'next/navigation';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { productReferenceList } from '../../[...slug]/product-reference-actions';
import { ProductReferenceWorkspace, type ReferenceKind } from '../../[...slug]/product-reference-workspace';

const map:Record<string,{kind:ReferenceKind;title:string;subtitle:string}>={
  marcas:{kind:'brands',title:'Marcas',subtitle:'Marcas comerciais vinculadas ao cadastro e à organização dos produtos.'},
  categorias:{kind:'categories',title:'Categorias',subtitle:'Categorias comerciais para organizar o catálogo de produtos.'},
  atributos:{kind:'attributes',title:'Atributos',subtitle:'Atributos e valores reutilizáveis na criação de grades e variações.'},
  unidades:{kind:'units',title:'Unidades de Medida',subtitle:'Unidades utilizadas nos produtos, estoque, compras e vendas.'},
};
export default async function ProductReferencePage({params}:{params:Promise<{reference:string}>}){const {reference}=await params;const config=map[reference];if(!config)notFound();const list=await productReferenceList(config.kind);return <AdvancedShell title={config.title} subtitle={config.subtitle} activePath={`/dashboard/produtos/${reference}`}><ProductReferenceWorkspace kind={config.kind} initial={list.data}/></AdvancedShell>}
