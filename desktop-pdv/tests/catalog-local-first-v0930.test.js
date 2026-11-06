'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../agent/store');
const {installProductCatalogMetaV081}=require('../agent/product-catalog-meta-v081');
const {installCatalogLocalFirstV0930,validCpf,validCnpj}=require('../agent/catalog-local-first-v0930');
class FakeAgent {
  constructor(store,allowed=true){
    this.store=store;
    this.allowed=allowed;
    this.sync={request:async()=>({ok:true}),running:false,run:async()=>({ok:true})};
  }
  _profileAllows(){return this.allowed;}
  currentOperator(){return {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Operador de teste'};}
  deviceToken(){return '';}
  async start(){}
  async stop(){}
}
installProductCatalogMetaV081(Store);
installCatalogLocalFirstV0930(FakeAgent,Store);
const newTestStore=()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'thor-catalog-test-'));
  const store=new Store(dir);
  return {store,close:()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});}};
};
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('validação local de CPF e CNPJ',()=>{
  assert.equal(validCpf('529.982.247-25'),true);
  assert.equal(validCpf('111.111.111-11'),false);
  assert.equal(validCnpj('11.222.333/0001-81'),true);
  assert.equal(validCnpj('11.111.111/1111-11'),false);
});

test('cliente salvo com CPF e outbox na mesma transação',()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    const r=agent.catalogLocalSave('customer_save',{id,name:'Cliente local',type:'PF',document:'529.982.247-25',email:'cliente@teste.local'});
    assert.equal(r.state,'pending');
    assert.equal(store.db.prepare('select document from customers where id=?').get(id).document,'52998224725');
    assert.equal(store.catalogOutbox().length,1);
    assert.throws(()=>agent.catalogLocalSave('customer_save',{name:'Outro',type:'PF',document:'111.111.111-11'}),/invalid_document/);
    assert.equal(store.catalogOutbox().length,1);
  }finally{close();}
});

test('perfil sem permissão não grava alterações',()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store,false);
    assert.throws(()=>agent.catalogLocalSave('customer_save',{name:'Sem perfil'}),/permission_denied/);
    assert.equal(store.catalogOutbox().length,0);
  }finally{close();}
});

test('produto, preço, estoque positivo e negativo com fila persistente',()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    const created=agent.catalogLocalSave('product_create',{id,name:'Produto local',unit:'UN',cost_price:5.25,sale_price:10,category:'',ncm:'12345678'});
    assert.equal(created.id,id);
    assert.equal(store.db.prepare('select cost_price from products where id=?').get(id).cost_price,5.25);
    agent.catalogLocalSave('product_price',{id,sale_price:12.5});
    assert.equal(store.db.prepare('select sale_price from products where id=?').get(id).sale_price,12.5);
    agent.catalogLocalSave('stock_adjust',{id,delta:7,reason:'Conferência'});
    agent.catalogLocalSave('stock_adjust',{id,delta:-2,reason:'Perda'});
    assert.equal(store.db.prepare('select quantity from inventory where product_id=?').get(id).quantity,5);
    assert.throws(()=>agent.catalogLocalSave('stock_adjust',{id,delta:-6,reason:'Retirada'}),/insufficient_stock/);
    assert.equal(store.catalogOutbox().length,4);
    assert.equal(store.catalogHistory().length,4);
  }finally{close();}
});

test('pull do servidor não apaga preço local pendente',()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    agent.catalogLocalSave('product_create',{id,name:'Produto',unit:'UN',cost_price:1,sale_price:7,ncm:'12345678'});
    agent.catalogLocalSave('product_price',{id,sale_price:9});
    store.applyPull({
      products:[{id,sku:'TESTE',name:'Produto remoto',unit:'UN',group_id:null,sale_price:7,active:true,barcodes:[]}],
      inventory:[],customers:[],price_items:[{product_id:id,price:7}],promotions:[],sales_history:[]
    });
    assert.equal(store.db.prepare('select sale_price from products where id=?').get(id).sale_price,9);
    assert.equal(store.db.prepare('select price from price_items where product_id=?').get(id).price,9);
  }finally{close();}
});

test('saldo local não é somado novamente após pull com ACK perdido',()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    agent.catalogLocalSave('product_create',{id,name:'Estoque',unit:'UN',cost_price:2,sale_price:5});
    agent.catalogLocalSave('stock_adjust',{id,delta:10,reason:'Inventário'});
    assert.equal(store.db.prepare('select quantity from inventory where product_id=?').get(id).quantity,10);
    store.applyPull({products:[],inventory:[{product_id:id,quantity:10,reserved_quantity:0}],
      customers:[],price_items:[],promotions:[],sales_history:[]});
    assert.equal(store.db.prepare('select quantity from inventory where product_id=?').get(id).quantity,10);
  }finally{close();}
});

test('rejeição de produto novo desativa produto local e reenvio exige permissão',()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    const result=agent.catalogLocalSave('product_create',{id,name:'Rejeitado',unit:'UN',cost_price:1,sale_price:2});
    const row=store.catalogOutbox(1)[0];
    agent.catalogRollback(row.kind,row.payload);
    store.catalogSetState(result.event_id,'rejected','category_not_found');
    assert.equal(store.db.prepare('select active from products where id=?').get(id).active,0);
    assert.equal(store.catalogOutbox(10).length,0);
    agent.allowed=false;
    assert.throws(()=>agent.catalogRetry(result.event_id),/permission_denied/);
    agent.allowed=true;
    assert.equal(agent.catalogRetry(result.event_id).ok,true);
    assert.equal(store.catalogOutbox(10).length,1);
  }finally{close();}
});

test('rejeição de regra de negócio não fica em retry infinito, e descarte destrava fila',async()=>{
  const {store,close}=newTestStore();
  try {
    const agent=new FakeAgent(store);
    agent.deviceToken=()=> 'token-de-teste';
    agent.sync.request=async()=>({ok:true,applied:false,error:'category_not_found'});
    const first=agent.catalogLocalSave('product_create',{id,name:'Produto sem grupo',unit:'UN',cost_price:1,sale_price:3,category:'Inexistente'});
    const next=agent.catalogLocalSave('customer_save',{name:'Novo Cliente'});
    const result=await agent.flushCatalogOutbox();
    assert.equal(result.ok,false);
    assert.equal(store.db.prepare('select state from catalog_outbox where event_id=?').get(first.event_id).state,'rejected');
    assert.equal(store.db.prepare('select state from catalog_outbox where event_id=?').get(next.event_id).state,'pending');
    assert.equal(store.catalogOutbox().length,0);
    assert.equal(agent.catalogDiscard(first.event_id).ok,true);
    assert.equal(store.db.prepare('select state from catalog_outbox where event_id=?').get(first.event_id).state,'discarded');
    assert.equal(store.catalogOutbox().length,1);
  }finally{close();}
});

test('erro de transporte preserva evento para nova tentativa',async()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    agent.deviceToken=()=> 'token-de-teste';
    agent.sync.request=async()=>{throw new Error('sync_timeout');};
    const mutation=agent.catalogLocalSave('customer_save',{name:'Cliente desconectado'});
    const result=await agent.flushCatalogOutbox();
    assert.equal(result.ok,false);
    const row=store.db.prepare('select state,attempts,error from catalog_outbox where event_id=?').get(mutation.event_id);
    assert.equal(row.state,'retry');
    assert.equal(row.error,'sync_timeout');
    assert.ok(row.attempts>=1);
  }finally{close();}
});

test('preço local envia versão esperada para detectar atualização concorrente',()=>{
  const {store,close}=newTestStore();
  try {
    const agent=new FakeAgent(store);
    agent.catalogLocalSave('product_create',{id,name:'Preço',unit:'UN',cost_price:2,sale_price:5});
    agent.catalogLocalSave('product_price',{id,sale_price:8});
    const item=store.catalogOutbox(10).find(r=>r.kind==='product_price');
    assert.equal(item.payload.expected_sale_price,5);
    assert.equal(item.payload.local_before.sale_price,5);
  }finally{close();}
});

test('não permite retirar estoque reservado no SQLite',()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    agent.catalogLocalSave('product_create',{id,name:'Reservado',unit:'UN',cost_price:1,sale_price:5});
    store.db.prepare('insert into inventory(product_id,quantity,reserved_quantity) values(?,?,?)').run(id,10,8);
    assert.throws(()=>agent.catalogLocalSave('stock_adjust',{id,delta:-3,reason:'Acerto'}),/insufficient_stock/);
    assert.equal(store.db.prepare('select quantity from inventory where product_id=?').get(id).quantity,10);
  }finally{close();}
});

test('push respeita dependência de produto e cliente antes de vendas e fechamento',async()=>{
  const {SyncEngine}=require('../agent/sync');
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    const product=agent.catalogLocalSave('product_create',{id,name:'Produto local',unit:'UN',cost_price:1,sale_price:2});
    const c=agent.catalogLocalSave('customer_save',{name:'Cliente local'});
    const sent=[];
    const sync=new SyncEngine({store,apiBase:'https://example.invalid',tokenProvider:()=> 'fake'});
    sync.request=async(_path,data)=>{sent.push(data.events.map(e=>e.type));return {ok:true,results:[]};};
    const events=[
      {id:'a',type:'cash_open',payload:{}},
      {id:'b',type:'sale_completed',payload:{customer_id:c.id,items:[{product_id:id}]}},
      {id:'c',type:'cash_close',payload:{}}
    ];
    const result=await sync.pushEvents(events);
    assert.equal(result.blocked,true);
    assert.deepEqual(sent,[['cash_open']]);
    store.catalogSetState(product.event_id,'synced');
    store.catalogSetState(c.event_id,'synced');
    await sync.pushEvents(events.slice(1));
    assert.deepEqual(sent,[['cash_open'],['sale_completed','cash_close']]);
  }finally{close();}
});

test('pull preserva preço pendente mesmo com rejeição anterior na fila',()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    const rejected=agent.catalogLocalSave('customer_save',{name:'Cliente sem validação'});
    agent.catalogLocalSave('product_create',{id,name:'Produto',unit:'UN',cost_price:2,sale_price:7});
    agent.catalogLocalSave('product_price',{id,sale_price:11});
    store.catalogSetState(rejected.event_id,'rejected','document_already_registered');
    assert.equal(store.catalogOutbox(100).length,0);
    assert.equal(store.catalogPendingOverlays(100).length,2);
    store.applyPull({
      products:[{id,name:'Produto remoto',unit:'UN',sale_price:7,active:true,barcodes:[]}],
      inventory:[],customers:[],price_items:[{product_id:id,price:7}],promotions:[],sales_history:[]
    });
    assert.equal(store.db.prepare('select sale_price from products where id=?').get(id).sale_price,11);
    assert.equal(store.db.prepare('select price from price_items where product_id=?').get(id).price,11);
  }finally{close();}
});

test('saldo do servidor prevalece após rejeição de ajuste de estoque',()=>{
  const {store,close}=newTestStore();
  try{
    const agent=new FakeAgent(store);
    agent.catalogLocalSave('product_create',{id,name:'Estoque servidor',unit:'UN',cost_price:1,sale_price:2});
    store.catalogApplyLocal('stock_adjust',{id,delta:4,reason:'Entrada',operator_user_id:agent.currentOperator().id});
    const rejected=store.catalogOutbox().find(x=>x.kind==='stock_adjust');
    store.catalogSetState(rejected.event_id,'rejected','permission_denied');
    store.applyPull({
      products:[],inventory:[{product_id:id,quantity:0,reserved_quantity:0}],
      customers:[],price_items:[],promotions:[],sales_history:[]
    });
    assert.equal(store.db.prepare('select quantity from inventory where product_id=?').get(id).quantity,0);
  }finally{close();}
});
