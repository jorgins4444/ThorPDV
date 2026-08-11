from pathlib import Path
import json

app_path = Path('desktop-pdv/renderer/app.js')
s = app_path.read_text(encoding='utf-8')

marker = "async function openSaleDetail(sale){"
helpers = r'''function saleItemCode(i){
  return String(i?.sku||i?.code||i?.internal_code||i?.product_code||i?.product_id||'—');
}

function saleDiscountTotals(detail,items){
  const safeItems=Array.isArray(items)?items:[];
  const gross=safeItems.reduce((sum,i)=>sum+(Number(i?.quantity||0)*Number(i?.unit_price||i?.unitPrice||0)),0);
  const itemDiscount=safeItems.reduce((sum,i)=>sum+Number(i?.discount||0),0);
  const saleDiscount=Number(detail?.discount||detail?.sale_discount||0);
  return {gross,itemDiscount,saleDiscount,totalDiscount:itemDiscount+saleDiscount};
}

function whatsappSaleModal(sale,type){
  const key=saleKey(sale),fiscalCancelled=String(sale?.fiscal?.status||'')==='cancelled';
  if(type==='pre_sale'&&fiscalCancelled){infoModal('Pré-venda indisponível',friendlyError('pre_sale_unavailable_cancelled_nfce'));return;}
  if(type==='nfce'&&!['authorized','cancelled'].includes(String(sale?.fiscal?.status||''))){infoModal('NFC-e',friendlyError('nfce_not_authorized'));return;}
  const label=type==='nfce'?'NFC-e':'pré-venda';
  const preset=String(sale?.customer_phone||sale?.phone||sale?.customer?.phone||'').replace(/\D/g,'');
  const m=modal(`<h3>Enviar ${esc(label)} pelo WhatsApp</h3><p class="muted">O THOR gera o PDF, abre a conversa no WhatsApp Web e deixa o arquivo selecionado no Explorador para anexação.</p><div class="field"><label>WhatsApp do cliente</label><input id="waPhone" inputmode="tel" autocomplete="tel" value="${esc(preset)}" placeholder="86999999999"></div><div class="whatsapp-share-note"><b>Documento</b><span>${esc(label)} ${sale?.number?`da venda #${esc(sale.number)}`:''}</span></div><div class="actions"><button class="secondary" id="waBack">Voltar</button><button class="primary whatsapp-button" id="waSend">Abrir WhatsApp</button></div>`);
  m.querySelector('#waBack').onclick=()=>m.remove();
  m.querySelector('#waSend').onclick=async()=>{
    const button=m.querySelector('#waSend');
    try{
      const phone=m.querySelector('#waPhone').value.trim();
      button.disabled=true;button.textContent='Gerando PDF...';
      const r=await window.thor.shareSaleWhatsapp(key,type,phone);
      m.remove();
      showToast(`WhatsApp aberto • ${r.filename} pronto em Downloads.`);
      setTimeout(()=>infoModal('Arquivo pronto',`O PDF ${r.filename} foi gerado e selecionado no Explorador. Arraste-o para a conversa do WhatsApp Web ou use o clipe para anexar.`),450);
    }catch(e){
      button.disabled=false;button.textContent='Abrir WhatsApp';
      infoModal('WhatsApp',friendlyError(String(e?.message||e)));
    }
  };
}

'''

if 'function saleDiscountTotals(' not in s:
    if marker not in s:
        raise SystemExit('openSaleDetail marker not found')
    s = s.replace(marker, helpers + marker, 1)

# User-facing action label.
s = s.replace('data-view-sale="${i}">Abrir</button>', 'data-view-sale="${i}">Visualizar</button>')

# Defensive click handler: prevents silent failures and keeps filtered row mapping intact.
old = "box.querySelectorAll('[data-view-sale]').forEach(b=>b.onclick=()=>openSaleDetail(rows[Number(b.dataset.viewSale)]));"
new = "box.querySelectorAll('[data-view-sale]').forEach(b=>b.onclick=async()=>{const index=Number(b.dataset.viewSale);const target=rows[index];if(!target){infoModal('Visualizar venda','Não foi possível localizar esta venda na lista atual. Atualize o Fiscal e tente novamente.');return;}try{await openSaleDetail(target);}catch(e){console.error('sale_detail_open_failed',e);infoModal('Visualizar venda',`Não foi possível carregar os detalhes desta venda. ${friendlyError(String(e?.message||e||''))}`);}});"
if old in s:
    s = s.replace(old, new, 1)
elif 'sale_detail_open_failed' not in s:
    raise SystemExit('fiscal sale click handler not found')

app_path.write_text(s, encoding='utf-8')

pkg_path = Path('desktop-pdv/package.json')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
pkg['version'] = '0.7.10'
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Assertions prevent a partial fix from being committed.
check = app_path.read_text(encoding='utf-8')
required = [
    'function saleItemCode(',
    'function saleDiscountTotals(',
    'function whatsappSaleModal(',
    '>Visualizar</button>',
    'sale_detail_open_failed',
]
missing = [x for x in required if x not in check]
if missing:
    raise SystemExit(f'missing expected fixes: {missing}')
print('PDV fiscal visualization fix applied')
