'use client';

import { ChangeEvent, useEffect, useMemo, useState, useTransition } from 'react';
import {
  erpGenerateProductBarcode,
  erpProductAddStock,
  erpProductCompositionSet,
  erpProductDetail,
  erpProductList,
  erpProductSave,
} from './actions';

type Row = Record<string, unknown>;
type PurchaseUnit = { unit:string; conversion_factor:number; barcode:string; is_default:boolean };
type CompositionItem = { component_product_id:string; quantity:number; unit:string; waste_percent:number; deduct_stock:boolean; notes?:string };

const units = [
  ['UN','Unidade'],['KG','Quilograma'],['CX','Caixa'],['PC','Peça'],['PCT','Pacote'],['FD','Fardo'],
  ['LT','Litro'],['ML','Mililitro'],['G','Grama'],['M','Metro'],['M2','Metro²'],['M3','Metro³'],
  ['DZ','Dúzia'],['BD','Balde'],['SC','Saco'],['RL','Rolo'],
] as const;

const productTypes = [
  ['fixed_asset','Ativo imobilizado'],
  ['packaging','Embalagem'],
  ['use_consumption','Material de uso e consumo'],
  ['raw_material','Matéria-prima'],
  ['resale','Mercadoria para revenda'],
  ['other','Outras'],
  ['other_inputs','Outros insumos'],
  ['finished_product','Produto acabado'],
  ['work_in_process','Produto em processo'],
  ['intermediate_product','Produto intermediário'],
  ['service','Serviços'],
  ['byproduct','Subproduto'],
] as const;

const productTypeLabel = (value:unknown) => productTypes.find(([code])=>code===text(value))?.[1] || 'Mercadoria para revenda';

const tabs = [
  ['required','Obrigatório'],
  ['settings','Configurações'],
  ['prices','Preços, Impostos e Modificadores'],
  ['stock','Estoque'],
  ['composition','Composição'],
  ['images','Auto-atendimento e Imagens'],
  ['history','Histórico'],
] as const;

type Tab = typeof tabs[number][0];
const text = (v:unknown) => v == null ? '' : String(v);
const num = (v:unknown) => Number(v || 0);
const bool = (v:unknown, fallback=false) => v == null ? fallback : Boolean(v);
const rows = (v:unknown):Row[] => Array.isArray(v) ? v as Row[] : [];
const obj = (v:unknown):Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const money = (v:unknown) => num(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

function blank(){
  return {
    id:'', product_code:'', sku:'', barcode:'', name:'', description:'', group_id:'', class_id:'', unit:'UN', product_type:'resale', active:true, is_weighable:false,
    supplier_id:'', exclusive_supplier:false, financial_category:'', stock_location:'', fractioned:false, prompt_quantity:false,
    modifiers_enabled:false, allow_discount:true, apply_surcharge:true, self_service:false, favorite:false, age_restricted:false,
    label_scale:false, shelf_life_days:'0', ncm:'', cest:'', cfop_default:'', origin:'0', cost_price:'0', sale_price:'0',
    minimum_stock:'0', stock_to_add:'', production_mode:'stock', production_yield:'1', production_printer:'', production_sector:'',
    auto_print_production:true, production_description:'', image_url:'', menu_image_url:'', self_service_image_url:'', menu_description:'',
    cst_icms:'', csosn:'', cst_pis:'', cst_cofins:'', cst_ipi:'', icms_rate:'', pis_rate:'', cofins_rate:'', ipi_rate:'',
  };
}

type Draft = ReturnType<typeof blank>;

async function imageData(e:ChangeEvent<HTMLInputElement>){
  const file = e.target.files?.[0];
  if(!file) return '';
  if(file.size > 350_000) throw new Error('Imagem acima de 350 KB. Reduza o arquivo.');
  return await new Promise<string>((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

function draftFromDetail(detail:Row):Draft {
  const p = obj(detail.product);
  const fp = obj(p.fiscal_profile);
  const barcodes = rows(detail.barcodes);
  return {
    ...blank(),
    id:text(p.id), product_code:text(p.product_code), sku:text(p.sku), barcode:text(barcodes.find(b=>b.is_primary)?.barcode || barcodes[0]?.barcode),
    name:text(p.name), description:text(p.description), group_id:text(p.group_id), class_id:text(p.class_id),
    unit:text(p.unit) || 'UN', product_type:text(p.product_type) || 'resale', active:p.active !== false, is_weighable:bool(p.is_weighable), supplier_id:text(p.supplier_id),
    exclusive_supplier:bool(p.exclusive_supplier), financial_category:text(p.financial_category), stock_location:text(p.stock_location),
    fractioned:bool(p.fractioned), prompt_quantity:bool(p.prompt_quantity), modifiers_enabled:bool(p.modifiers_enabled),
    allow_discount:bool(p.allow_discount,true), apply_surcharge:bool(p.apply_surcharge,true), self_service:bool(p.self_service),
    favorite:bool(p.favorite), age_restricted:bool(p.age_restricted), label_scale:bool(p.label_scale), shelf_life_days:text(p.shelf_life_days || 0),
    ncm:text(p.ncm), cest:text(p.cest), cfop_default:text(p.cfop_default), origin:text(p.origin || 0),
    cost_price:text(p.cost_price || 0), sale_price:text(p.sale_price || 0), minimum_stock:text(p.minimum_stock || 0), stock_to_add:'',
    production_mode:text(p.production_mode) || 'stock', production_yield:text(p.production_yield || 1), production_printer:text(p.production_printer),
    production_sector:text(p.production_sector), auto_print_production:bool(p.auto_print_production,true), production_description:text(p.production_description),
    image_url:text(p.image_url), menu_image_url:text(p.menu_image_url), self_service_image_url:text(p.self_service_image_url), menu_description:text(p.menu_description),
    cst_icms:text(fp.cst_icms), csosn:text(fp.csosn), cst_pis:text(fp.cst_pis), cst_cofins:text(fp.cst_cofins), cst_ipi:text(fp.cst_ipi),
    icms_rate:text(fp.icms_rate), pis_rate:text(fp.pis_rate), cofins_rate:text(fp.cofins_rate), ipi_rate:text(fp.ipi_rate),
  };
}

function ProductEditor({row,products,groups,classes,suppliers,modifiers,branches,onClose,onSaved}:{
  row:Row|null; products:Row[]; groups:Row[]; classes:Row[]; suppliers:Row[]; modifiers:Row[]; branches:Row[];
  onClose:()=>void; onSaved:()=>Promise<void>;
}){
  const selectedId = text(row?.id);
  const [activeTab,setActiveTab] = useState<Tab>('required');
  const [pending,startTransition] = useTransition();
  const [message,setMessage] = useState('');
  const [loaded,setLoaded] = useState(!selectedId);
  const [draft,setDraft] = useState<Draft>(()=>blank());
  const [purchaseUnits,setPurchaseUnits] = useState<PurchaseUnit[]>([]);
  const [composition,setComposition] = useState<CompositionItem[]>([]);
  const [modifierIds,setModifierIds] = useState<string[]>([]);
  const [stockRows,setStockRows] = useState<Row[]>([]);
  const [history,setHistory] = useState<Row[]>([]);

  const filteredClasses = useMemo(
    ()=>classes.filter(c=>!draft.group_id || !c.group_id || text(c.group_id)===draft.group_id),
    [classes,draft.group_id]
  );
  const productMap = useMemo(()=>new Map(products.map(p=>[text(p.id),p])),[products]);
  const compositionCost = composition.reduce((sum,item)=>{
    const product = productMap.get(item.component_product_id);
    return sum + item.quantity * (1 + item.waste_percent/100) * num(product?.cost_price);
  },0);
  const set = <K extends keyof Draft>(key:K,value:Draft[K]) => setDraft(current=>({...current,[key]:value}));

  useEffect(()=>{
    let cancelled = false;
    setActiveTab('required');
    setMessage('');

    if(!selectedId){
      setDraft(blank());
      setPurchaseUnits([]);
      setComposition([]);
      setModifierIds([]);
      setStockRows([]);
      setHistory([]);
      setLoaded(true);
      return ()=>{ cancelled = true; };
    }

    setLoaded(false);
    void (async()=>{
      const result = await erpProductDetail(selectedId);
      if(cancelled) return;
      if(!result.ok){
        setMessage(`Não foi possível abrir o produto: ${text(result.error || 'erro_desconhecido')}`);
        setLoaded(true);
        return;
      }

      const detail = obj(result.data);
      setDraft(draftFromDetail(detail));
      setPurchaseUnits(rows(detail.purchase_units).map(u=>({
        unit:text(u.unit)||'UN', conversion_factor:num(u.conversion_factor)||1, barcode:text(u.barcode), is_default:bool(u.is_default),
      })));
      setComposition(rows(detail.composition).map(i=>({
        component_product_id:text(i.component_product_id), quantity:num(i.quantity), unit:text(i.unit)||'UN',
        waste_percent:num(i.waste_percent), deduct_stock:i.deduct_stock!==false, notes:text(i.notes),
      })));
      setModifierIds(rows(detail.modifiers).filter(m=>m.linked).map(m=>text(m.id)));
      setStockRows(rows(detail.stock));
      setHistory(rows(detail.history));
      setLoaded(true);
    })();

    return ()=>{ cancelled = true; };
  },[selectedId]);

  const generateBarcode = () => startTransition(async()=>{
    const result = await erpGenerateProductBarcode();
    if(result.ok) set('barcode',text(result.barcode));
    else setMessage(text(result.error || 'Não foi possível gerar o código de barras.'));
  });

  const refreshDetail = async(productId:string) => {
    const result = await erpProductDetail(productId);
    if(!result.ok) return;
    const detail = obj(result.data);
    setStockRows(rows(detail.stock));
    setHistory(rows(detail.history));
  };

  const save = () => startTransition(async()=>{
    setMessage('');
    if(!draft.name.trim()) return setMessage('Informe a descrição do produto.');
    if(!draft.product_type) return setMessage('Selecione o tipo de produto.');
    if(num(draft.sale_price) < 0) return setMessage('Preço de venda inválido.');
    if((draft.production_mode === 'on_demand' || draft.production_mode === 'batch') && num(draft.production_yield) <= 0){
      return setMessage('O rendimento da composição deve ser maior que zero.');
    }

    const fiscal_profile = {
      cst_icms:draft.cst_icms || null,
      csosn:draft.csosn || null,
      cst_pis:draft.cst_pis || null,
      cst_cofins:draft.cst_cofins || null,
      cst_ipi:draft.cst_ipi || null,
      icms_rate:num(draft.icms_rate),
      pis_rate:num(draft.pis_rate),
      cofins_rate:num(draft.cofins_rate),
      ipi_rate:num(draft.ipi_rate),
    };

    const result = await erpProductSave({
      ...draft,
      cost_price:num(draft.cost_price), sale_price:num(draft.sale_price), minimum_stock:num(draft.minimum_stock),
      stock_to_add:num(draft.stock_to_add), shelf_life_days:num(draft.shelf_life_days), production_yield:num(draft.production_yield),
      purchase_units:purchaseUnits, modifier_ids:modifierIds, fiscal_profile,
    });
    if(!result.ok) return setMessage(`Não foi possível salvar: ${text(result.error)}`);

    const productId = text(result.id);
    const compositionResult = await erpProductCompositionSet(productId,composition);
    if(!compositionResult.ok){
      setMessage(`Produto salvo, mas a composição não pôde ser atualizada: ${text(compositionResult.error)}`);
      return;
    }

    setDraft(current=>({...current,id:productId,stock_to_add:''}));
    await refreshDetail(productId);
    await onSaved();
    setMessage('Produto salvo e integrado com sucesso.');
  });

  const addPurchase = () => setPurchaseUnits(current=>[
    ...current,{unit:'CX',conversion_factor:1,barcode:'',is_default:current.length===0},
  ]);

  const addComposition = () => {
    const first = products.find(p=>text(p.id)!==draft.id);
    if(!first) return setMessage('Cadastre ao menos um insumo antes de criar a composição.');
    setComposition(current=>[...current,{
      component_product_id:text(first.id), quantity:1, unit:text(first.unit)||'UN', waste_percent:0, deduct_stock:true,
    }]);
  };

  const addStock = () => {
    if(!draft.id) return setMessage('Salve o produto antes de lançar estoque.');
    const quantity = num(draft.stock_to_add);
    if(quantity<=0) return setMessage('Informe uma quantidade maior que zero.');
    startTransition(async()=>{
      const result = await erpProductAddStock(draft.id,quantity,num(draft.cost_price));
      if(!result.ok) return setMessage(text(result.error || 'Não foi possível registrar a entrada.'));
      set('stock_to_add','');
      await refreshDetail(draft.id);
      await onSaved();
      setMessage(`Entrada de estoque registrada: +${quantity}.`);
    });
  };

  if(!loaded){
    return <section className="product-editor-card"><div className="product-loading">Carregando cadastro completo...</div></section>;
  }

  return <section className="product-editor-card">
    <div className="product-editor-head">
      <div>
        <button type="button" className="product-back" onClick={onClose}>← Voltar</button>
        <h2>{draft.name || 'Novo Produto'}</h2>
        <p>{draft.id ? `${productTypeLabel(draft.product_type)} • ${draft.unit} • Código principal ${draft.product_code || '—'}${draft.sku ? ` • Ref. ${draft.sku}` : ''}` : 'O código principal será gerado automaticamente ao salvar o produto.'}</p>
      </div>
      <button type="button" className="product-primary" onClick={save} disabled={pending}>💾 {pending?'Salvando...':'Gravar'}</button>
    </div>

    <div className="product-tabs">
      {tabs.map(([id,label])=><button type="button" key={id} className={activeTab===id?'active':''} onClick={()=>setActiveTab(id)}>{label}</button>)}
    </div>
    {message && <div className="product-message">{message}</div>}

    {activeTab==='required' && <div className="product-tab-panel">
      <div className="product-form-grid cols4">
        <label className="span2"><span>Descrição do produto *</span><input value={draft.name} onChange={e=>set('name',e.target.value)}/></label>
        <label><span>Status</span><YesNo value={draft.active} onChange={v=>set('active',v)} yes="Ativo" no="Inativo"/></label>
        <label><span>Código principal</span><input value={draft.product_code || 'Automático ao salvar'} readOnly/><small>Sequencial, exclusivo e imutável.</small></label><label><span>Referência interna</span><input value={draft.sku} onChange={e=>set('sku',e.target.value)} placeholder="Opcional: código legado, fornecedor..."/><small>Campo livre; não substitui o código principal.</small></label>
        <label><span>Tipo de produto *</span><select required value={draft.product_type} onChange={e=>set('product_type',e.target.value)}>{productTypes.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
        <label><span>Grupo</span><select value={draft.group_id} onChange={e=>{set('group_id',e.target.value);set('class_id','')}}><option value="">Selecione</option>{groups.map(g=><option key={text(g.id)} value={text(g.id)}>{text(g.name)}</option>)}</select></label>
        <label><span>Classe</span><select value={draft.class_id} onChange={e=>set('class_id',e.target.value)}><option value="">Selecione</option>{filteredClasses.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.name)}</option>)}</select></label>
        <label><span>Unidade de estoque</span><select value={draft.unit} onChange={e=>set('unit',e.target.value)}>{units.map(([code,label])=><option key={code} value={code}>{code} - {label}</option>)}</select></label>
        <label><span>Categoria financeira</span><input value={draft.financial_category} onChange={e=>set('financial_category',e.target.value)}/></label>
        <label className="span2"><span>EAN / GTIN</span><div className="inline-input"><input value={draft.barcode} onChange={e=>set('barcode',e.target.value.replace(/\s/g,''))}/><button type="button" onClick={generateBarcode}>Gerar automático</button></div><small>O automático gera EAN-13 interno; informe o GTIN oficial quando existir.</small></label>
        <label className="span2"><span>Descrição complementar</span><input value={draft.description} onChange={e=>set('description',e.target.value)}/></label>
      </div>
      <fieldset className="product-fieldset">
        <legend>Unidades de compra</legend>
        <button type="button" className="product-secondary" onClick={addPurchase}>+ Adicionar unidade</button>
        {purchaseUnits.map((unit,index)=><div className="purchase-row" key={index}>
          <select value={unit.unit} onChange={e=>setPurchaseUnits(current=>current.map((x,i)=>i===index?{...x,unit:e.target.value}:x))}>{units.map(([code,label])=><option value={code} key={code}>{code} - {label}</option>)}</select>
          <input type="number" min="0.000001" step="0.000001" value={unit.conversion_factor} onChange={e=>setPurchaseUnits(current=>current.map((x,i)=>i===index?{...x,conversion_factor:num(e.target.value)}:x))} placeholder="Fator para estoque"/>
          <input value={unit.barcode} onChange={e=>setPurchaseUnits(current=>current.map((x,i)=>i===index?{...x,barcode:e.target.value}:x))} placeholder="EAN/GTIN da compra"/>
          <label className="check"><input type="checkbox" checked={unit.is_default} onChange={e=>setPurchaseUnits(current=>current.map((x,i)=>({...x,is_default:i===index?e.target.checked:false})))}/> Padrão</label>
          <button type="button" onClick={()=>setPurchaseUnits(current=>current.filter((_,i)=>i!==index))}>Excluir</button>
        </div>)}
      </fieldset>
    </div>}

    {activeTab==='settings' && <div className="product-tab-panel"><div className="product-form-grid cols4">
      <label><span>Fornecedor</span><select value={draft.supplier_id} onChange={e=>set('supplier_id',e.target.value)}><option value="">Nenhum</option>{suppliers.map(s=><option key={text(s.id)} value={text(s.id)}>{text(s.name)}</option>)}</select></label>
      <label><span>Fornecedor exclusivo</span><YesNo value={draft.exclusive_supplier} onChange={v=>set('exclusive_supplier',v)}/></label>
      <label><span>Baixa de estoque</span><select value={draft.production_mode} onChange={e=>set('production_mode',e.target.value)}><option value="stock">Baixa o próprio produto</option><option value="on_demand">Produção sob demanda / baixa insumos</option><option value="batch">Produção em lote</option></select></label>
      <label><span>Local do estoque</span><input value={draft.stock_location} onChange={e=>set('stock_location',e.target.value)}/></label>
      <label><span>Campo fracionado</span><YesNo value={draft.fractioned} onChange={v=>set('fractioned',v)}/></label>
      <label><span>Chama quantidade</span><YesNo value={draft.prompt_quantity} onChange={v=>set('prompt_quantity',v)}/></label>
      <label><span>Chama balança / Pesável</span><YesNo value={draft.is_weighable} onChange={v=>{set('is_weighable',v);if(v&&draft.unit==='UN')set('unit','KG')}}/></label>
      <label><span>Chama modificadores</span><YesNo value={draft.modifiers_enabled} onChange={v=>set('modifiers_enabled',v)}/></label>
      <label><span>Permite desconto</span><YesNo value={draft.allow_discount} onChange={v=>set('allow_discount',v)}/></label>
      <label><span>Incide acréscimo</span><YesNo value={draft.apply_surcharge} onChange={v=>set('apply_surcharge',v)}/></label>
      <label><span>Auto-atendimento</span><YesNo value={draft.self_service} onChange={v=>set('self_service',v)}/></label>
      <label><span>Favorito</span><YesNo value={draft.favorite} onChange={v=>set('favorite',v)}/></label>
      <label><span>Venda +18</span><YesNo value={draft.age_restricted} onChange={v=>set('age_restricted',v)}/></label>
      <label><span>Balança etiquetadora</span><YesNo value={draft.label_scale} onChange={v=>set('label_scale',v)}/></label>
      <label><span>Dias de validade</span><input type="number" min="0" value={draft.shelf_life_days} onChange={e=>set('shelf_life_days',e.target.value)}/></label>
      <label><span>Setor de produção</span><input value={draft.production_sector} onChange={e=>set('production_sector',e.target.value)} placeholder="Ex.: Cozinha, Bar, Pizzaria"/></label>
      <label className="span2"><span>Descrição detalhada</span><textarea rows={5} value={draft.description} onChange={e=>set('description',e.target.value)}/></label>
      <label className="span2"><span>Descrição para produção / modo de preparo</span><textarea rows={5} value={draft.production_description} onChange={e=>set('production_description',e.target.value)}/></label>
    </div></div>}

    {activeTab==='prices' && <div className="product-tab-panel">
      <div className="product-form-grid cols4">
        <label><span>Preço de custo</span><input type="number" min="0" step="0.01" value={draft.cost_price} onChange={e=>set('cost_price',e.target.value)}/></label>
        <label><span>Preço de venda</span><input type="number" min="0" step="0.01" value={draft.sale_price} onChange={e=>set('sale_price',e.target.value)}/></label>
        <label><span>NCM</span><input value={draft.ncm} onChange={e=>set('ncm',e.target.value)}/></label>
        <label><span>CEST</span><input value={draft.cest} onChange={e=>set('cest',e.target.value)}/></label>
        <label><span>CFOP padrão</span><input value={draft.cfop_default} onChange={e=>set('cfop_default',e.target.value)}/></label>
        <label><span>Origem</span><select value={draft.origin} onChange={e=>set('origin',e.target.value)}>{Array.from({length:9},(_,i)=><option key={i} value={i}>{i}</option>)}</select></label>
        <label><span>CST ICMS</span><input value={draft.cst_icms} onChange={e=>set('cst_icms',e.target.value)}/></label>
        <label><span>CSOSN</span><input value={draft.csosn} onChange={e=>set('csosn',e.target.value)}/></label>
        <label><span>CST PIS</span><input value={draft.cst_pis} onChange={e=>set('cst_pis',e.target.value)}/></label>
        <label><span>CST COFINS</span><input value={draft.cst_cofins} onChange={e=>set('cst_cofins',e.target.value)}/></label>
        <label><span>CST IPI</span><input value={draft.cst_ipi} onChange={e=>set('cst_ipi',e.target.value)}/></label>
        <label><span>ICMS %</span><input type="number" step="0.01" value={draft.icms_rate} onChange={e=>set('icms_rate',e.target.value)}/></label>
        <label><span>PIS %</span><input type="number" step="0.01" value={draft.pis_rate} onChange={e=>set('pis_rate',e.target.value)}/></label>
        <label><span>COFINS %</span><input type="number" step="0.01" value={draft.cofins_rate} onChange={e=>set('cofins_rate',e.target.value)}/></label>
        <label><span>IPI %</span><input type="number" step="0.01" value={draft.ipi_rate} onChange={e=>set('ipi_rate',e.target.value)}/></label>
      </div>
      <fieldset className="product-fieldset"><legend>Modificadores</legend><div className="modifier-grid">
        {modifiers.map(m=><label className="check" key={text(m.id)}><input type="checkbox" checked={modifierIds.includes(text(m.id))} onChange={e=>setModifierIds(current=>e.target.checked?[...current,text(m.id)]:current.filter(id=>id!==text(m.id)))}/>{text(m.name)} <small>{num(m.price_delta)?`(${money(m.price_delta)})`:''}</small></label>)}
      </div></fieldset>
    </div>}

    {activeTab==='stock' && <div className="product-tab-panel">
      <div className="stock-summary-grid">{branches.map(branch=>{
        const stock = stockRows.find(x=>text(x.branch_id)===text(branch.id));
        return <article key={text(branch.id)}><span>{text(branch.name)}</span><strong>{num(stock?.quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})} {draft.unit}</strong><small>Reservado: {num(stock?.reserved).toLocaleString('pt-BR',{maximumFractionDigits:3})} • Disponível: {num(stock?.available).toLocaleString('pt-BR',{maximumFractionDigits:3})}</small></article>;
      })}</div>
      <div className="product-form-grid cols3">
        <label><span>Estoque mínimo</span><input type="number" step="0.001" min="0" value={draft.minimum_stock} onChange={e=>set('minimum_stock',e.target.value)}/></label>
        <label><span>Entrada de estoque</span><input type="number" step="0.001" min="0" value={draft.stock_to_add} onChange={e=>set('stock_to_add',e.target.value)}/></label>
        <label><span>&nbsp;</span><button type="button" className="product-primary full" onClick={addStock}>Registrar entrada</button></label>
      </div>
      {draft.production_mode==='on_demand' && <div className="product-alert">Produto sob demanda: o saldo do produto acabado não é baixado na venda. Os insumos da composição são consumidos automaticamente.</div>}
    </div>}

    {activeTab==='composition' && <div className="product-tab-panel">
      <div className="product-form-grid cols4">
        <label><span>Modo de produção</span><select value={draft.production_mode} onChange={e=>set('production_mode',e.target.value)}><option value="stock">Produto comum / estoque próprio</option><option value="on_demand">Sob demanda ao vender</option><option value="batch">Produção em lote</option></select></label>
        <label><span>Rendimento da ficha</span><input type="number" min="0.000001" step="0.001" value={draft.production_yield} onChange={e=>set('production_yield',e.target.value)}/></label>
        <label><span>Setor</span><input value={draft.production_sector} onChange={e=>set('production_sector',e.target.value)} placeholder="Cozinha"/></label>
        <label><span>Impressora de produção</span><input value={draft.production_printer} onChange={e=>set('production_printer',e.target.value)} placeholder="Ex.: EPSON Cozinha"/></label>
        <label><span>Imprimir automaticamente</span><YesNo value={draft.auto_print_production} onChange={v=>set('auto_print_production',v)}/></label>
        <label className="span3"><span>Descrição / instruções de preparo</span><input value={draft.production_description} onChange={e=>set('production_description',e.target.value)}/></label>
      </div>
      <div className="composition-head"><div><h3>Ficha técnica / Insumos</h3><p>Quantidade informada corresponde ao rendimento acima.</p></div><button type="button" className="product-secondary" onClick={addComposition}>+ Adicionar insumo</button></div>
      <div className="composition-table"><table><thead><tr><th>Insumo</th><th>Qtd.</th><th>Un.</th><th>Perda %</th><th>Baixa estoque</th><th>Custo</th><th></th></tr></thead><tbody>
        {composition.length===0?<tr><td colSpan={7}>Nenhum insumo configurado.</td></tr>:composition.map((item,index)=>{
          const product = productMap.get(item.component_product_id);
          const cost = item.quantity * (1 + item.waste_percent/100) * num(product?.cost_price);
          return <tr key={`${item.component_product_id}-${index}`}>
            <td><select value={item.component_product_id} onChange={e=>setComposition(current=>current.map((x,i)=>i===index?{...x,component_product_id:e.target.value,unit:text(productMap.get(e.target.value)?.unit)||x.unit}:x))}>{products.filter(p=>text(p.id)!==draft.id).map(p=><option key={text(p.id)} value={text(p.id)}>Cód. {text(p.product_code)||'—'} - {text(p.name)}{p.sku?` • Ref. ${text(p.sku)}`:''}</option>)}</select></td>
            <td><input type="number" min="0.000001" step="0.000001" value={item.quantity} onChange={e=>setComposition(current=>current.map((x,i)=>i===index?{...x,quantity:num(e.target.value)}:x))}/></td>
            <td><select value={item.unit} onChange={e=>setComposition(current=>current.map((x,i)=>i===index?{...x,unit:e.target.value}:x))}>{units.map(([code])=><option value={code} key={code}>{code}</option>)}</select></td>
            <td><input type="number" step="0.01" min="0" value={item.waste_percent} onChange={e=>setComposition(current=>current.map((x,i)=>i===index?{...x,waste_percent:num(e.target.value)}:x))}/></td>
            <td><input type="checkbox" checked={item.deduct_stock} onChange={e=>setComposition(current=>current.map((x,i)=>i===index?{...x,deduct_stock:e.target.checked}:x))}/></td>
            <td>{money(cost)}</td><td><button type="button" onClick={()=>setComposition(current=>current.filter((_,i)=>i!==index))}>🗑</button></td>
          </tr>;
        })}
      </tbody><tfoot><tr><td colSpan={5}>Custo estimado da ficha</td><td><strong>{money(compositionCost)}</strong></td><td/></tr></tfoot></table></div>
      {draft.production_mode==='on_demand' && <div className="product-alert success">Ao finalizar a venda no ThorPDV, esta ficha é transformada automaticamente em ordem/comanda de produção; os insumos são baixados e o pedido é enviado para a impressora configurada.</div>}
    </div>}

    {activeTab==='images' && <div className="product-tab-panel">
      <div className="image-grid">
        <ImageField title="Imagem do produto" value={draft.image_url} onChange={value=>set('image_url',value)}/>
        <ImageField title="Imagem para cardápio" value={draft.menu_image_url} onChange={value=>set('menu_image_url',value)}/>
        <ImageField title="Imagem auto-atendimento" value={draft.self_service_image_url} onChange={value=>set('self_service_image_url',value)}/>
      </div>
      <label className="image-description"><span>Descrição Tablet / QR Code / Cardápio</span><input value={draft.menu_description} onChange={e=>set('menu_description',e.target.value)}/></label>
    </div>}

    {activeTab==='history' && <div className="product-tab-panel"><div className="history-list">
      {history.length===0?<p>Nenhum histórico disponível.</p>:history.map(h=><article key={text(h.id)}><div><strong>{text(h.description)}</strong><small>{text(h.event_type)}</small></div><time>{new Date(text(h.created_at)).toLocaleString('pt-BR')}</time></article>)}
    </div></div>}

    <div className="product-editor-footer"><button type="button" onClick={onClose}>← Voltar</button><button type="button" className="product-primary" onClick={save} disabled={pending}>💾 {pending?'Salvando...':'Gravar'}</button></div>
  </section>;
}

function YesNo({value,onChange,yes='SIM',no='NÃO'}:{value:boolean;onChange:(v:boolean)=>void;yes?:string;no?:string}){
  return <select value={value?'yes':'no'} onChange={e=>onChange(e.target.value==='yes')}><option value="no">{no}</option><option value="yes">{yes}</option></select>;
}

function ImageField({title,value,onChange}:{title:string;value:string;onChange:(v:string)=>void}){
  const [error,setError] = useState('');
  return <div className="image-field"><h3>{title}</h3><label className="file-button">Selecionar arquivo<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={async e=>{try{setError('');const data=await imageData(e);if(data)onChange(data)}catch(err){setError(err instanceof Error?err.message:String(err))}}}/></label>{error&&<small>{error}</small>}<div className="image-preview">{value?<img src={value} alt={title}/>:<span>SEM IMAGEM</span>}</div></div>;
}

export function ProductMasterWorkspace({initialProducts,groups,classes,suppliers,modifiers,branches}:{
  initialProducts:Row[]; groups:Row[]; classes:Row[]; suppliers:Row[]; modifiers:Row[]; branches:Row[];
}){
  const [products,setProducts] = useState(initialProducts);
  const [search,setSearch] = useState('');
  const [editing,setEditing] = useState<Row|null|undefined>(undefined);
  const [message,setMessage] = useState('');
  const [pending,startTransition] = useTransition();

  const refresh = async()=>{
    const result = await erpProductList(search);
    if(result.ok) setProducts(result.data);
    else setMessage(text(result.error || 'Não foi possível atualizar a lista.'));
  };

  if(editing !== undefined){
    return <ProductEditor
      key={editing ? text(editing.id) : 'new'}
      row={editing}
      products={products}
      groups={groups}
      classes={classes}
      suppliers={suppliers}
      modifiers={modifiers}
      branches={branches}
      onClose={()=>setEditing(undefined)}
      onSaved={refresh}
    />;
  }

  return <div className="product-workspace">
    <section className="product-kpis">
      <article><span>Produtos</span><strong>{products.length}</strong><small>{products.filter(p=>p.active!==false).length} ativos</small></article>
      <article><span>Pesáveis</span><strong>{products.filter(p=>p.is_weighable).length}</strong><small>balança / peso</small></article>
      <article><span>Produção</span><strong>{products.filter(p=>text(p.production_mode)==='on_demand').length}</strong><small>sob demanda</small></article>
      <article><span>Valor em estoque</span><strong>{money(products.reduce((sum,p)=>sum+num(p.stock)*num(p.cost_price),0))}</strong><small>custo × saldo</small></article>
    </section>

    <section className="product-card">
      <div className="product-toolbar">
        <form onSubmit={e=>{e.preventDefault();startTransition(refresh)}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar descrição, código principal, referência interna ou EAN..."/><button type="submit">Buscar</button></form>
        <button type="button" className="product-primary" onClick={()=>setEditing(null)}>+ Novo Produto</button>
      </div>
      {message && <div className="product-message">{message}</div>}
      <div className="product-table-wrap"><table className="product-table"><thead><tr><th>Código principal</th><th>Referência interna</th><th>EAN</th><th>Produto</th><th>Tipo produto</th><th>Un.</th><th>Venda</th><th>Estoque</th><th>Operação</th><th>Status</th><th></th></tr></thead><tbody>
        {products.length===0?<tr><td colSpan={11} className="product-empty">Nenhum produto encontrado.</td></tr>:products.map(product=><tr key={text(product.id)}>
          <td><strong>{text(product.product_code)||'—'}</strong></td><td>{text(product.sku)||'—'}</td><td className="mono">{text(product.barcode)||'—'}</td>
          <td><strong>{text(product.name)}</strong><small>{text(product.group_name)||'Sem grupo'}</small></td>
          <td><span className="product-pill">{productTypeLabel(product.product_type)}</span></td>
          <td>{text(product.unit)||'UN'}</td><td>{money(product.sale_price)}</td><td>{num(product.stock).toLocaleString('pt-BR',{maximumFractionDigits:3})}</td>
          <td>{text(product.production_mode)==='on_demand'?<span className="product-pill weighable">🍳 Sob demanda</span>:product.is_weighable?<span className="product-pill weighable">⚖ Pesável</span>:<span className="product-pill">Comum</span>}</td>
          <td><span className={`product-status ${product.active===false?'off':''}`}>{product.active===false?'Inativo':'Ativo'}</span></td>
          <td><button type="button" className="product-link" onClick={()=>setEditing(product)}>Editar</button></td>
        </tr>)}
      </tbody></table></div>
      {pending && <small>Atualizando...</small>}
    </section>
  </div>;
}
