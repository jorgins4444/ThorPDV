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
