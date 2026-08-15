'use client';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const money=(v:unknown)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>{if(!v)return '';const s=String(v).slice(0,10).split('-');return s.length===3?`${s[2]}/${s[1]}/${s[0]}`:String(v)};
const digits=(v:unknown)=>text(v).replace(/\D/g,'');
function document(v:unknown){const d=digits(v);if(d.length===14)return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');if(d.length===11)return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');return text(v)}
function cep(v:unknown){const d=digits(v);return d.length===8?`${d.slice(0,5)}-${d.slice(5)}`:text(v)}
function address(p:Row){return [p.street,p.number,p.complement,p.district,p.city&&p.state?`${text(p.city)} - ${text(p.state)}`:p.city,p.postal_code?`CEP: ${cep(p.postal_code)}`:''].map(text).filter(Boolean).join(' · ')}

const patterns:Record<string,string>={0:'nnwwn',1:'wnnnw',2:'nwnnw',3:'wwnnn',4:'nnwnw',5:'wnwnn',6:'nwwnn',7:'nnnww',8:'wnnwn',9:'nwnwn'};
function Barcode({value}:{value:string}){
  const code=digits(value);if(code.length!==44)return <div className="boleto-barcode-error">Código de barras inválido</div>;
  const sequence:{bar:boolean;wide:boolean}[]=[];
  const push=(bar:boolean,wide:boolean)=>sequence.push({bar,wide});
  push(true,false);push(false,false);push(true,false);push(false,false);
  for(let i=0;i<code.length;i+=2){const a=patterns[code[i]],b=patterns[code[i+1]];for(let j=0;j<5;j++){push(true,a[j]==='w');push(false,b[j]==='w')}}
  push(true,true);push(false,false);push(true,false);
  const narrow=1.25,wide=3.75,quiet=8,height=45;let x=quiet;
  const rects=sequence.map((s,i)=>{const w=s.wide?wide:narrow;const el=s.bar?<rect key={i} x={x} y="0" width={w} height={height}/>:null;x+=w;return el});
  return <svg className="boleto-barcode" viewBox={`0 0 ${x+quiet} ${height}`} preserveAspectRatio="none" role="img" aria-label="Código de barras do boleto">{rects}</svg>;
}

function BankMark(){return <div className="boleto-bank-brand"><span className="boleto-itau-mark">Itaú</span><b>Banco Itaú</b></div>}
function BankHeader({bank,title}:{bank:Row;title?:string}){return <div className="boleto-bank-header"><BankMark/><strong>{text(bank.code_display)||'341-7'}</strong><b className="boleto-line">{title||''}</b></div>}
function Cell({label,children,className='' }:{label:string;children?:React.ReactNode;className?:string}){return <div className={`boleto-cell ${className}`}><small>{label}</small><div>{children||' '}</div></div>}
function Party({label,party}:{label:string;party:Row}){return <div className="boleto-party"><small>{label}</small><b>{text(party.name)}{party.document?` · ${document(party.document)}`:''}</b><span>{address(party)}</span></div>}

export function ItauBoletoPrint({data}:{data:Row}){
  const bank=(data.bank as Row)||{},beneficiary=(data.beneficiary as Row)||{},payer=(data.payer as Row)||{},title=(data.title as Row)||{},print=(data.print as Row)||{};
  const instructions=Array.isArray(print.instructions)?print.instructions.map(text).filter(Boolean):[];
  const line=text(title.digitable_line);
  return <main className="boleto-print-page">
    <div className="boleto-screen-actions"><button type="button" onClick={()=>history.back()}>← Voltar</button><div><span>{title.is_homologation_test?'Boleto de homologação · ':''}{text(title.our_number_display)}</span><button className="primary" type="button" onClick={()=>window.print()}>Imprimir boleto</button></div></div>

    <section className="boleto-paper">
      <section className="boleto-receipt">
        <div className="boleto-caption">Recibo do Pagador</div>
        <BankHeader bank={bank} title={line}/>
        <div className="boleto-grid receipt-main">
          <Cell label="Beneficiário" className="span-6"><b>{text(beneficiary.name)}</b>{beneficiary.document?` (${document(beneficiary.document)})`:''}<br/><span>{address(beneficiary)}</span></Cell>
          <Cell label="Agência / Código beneficiário" className="span-3"><b>{text(beneficiary.code_display)}</b></Cell>
          <Cell label="Nosso número" className="span-3"><b>{text(title.our_number_display)}</b></Cell>
          <Cell label="Número do documento" className="span-2"><b>{text(title.document_number)}</b></Cell>
          <Cell label="Espécie moeda" className="span-1">{text(title.currency)||'R$'}</Cell>
          <Cell label="Quantidade" className="span-2"/>
          <Cell label="Data processamento" className="span-2">{date(title.processing_date)}</Cell>
          <Cell label="Carteira" className="span-1"><b>{text(title.wallet)}</b></Cell>
          <Cell label="Vencimento" className="span-2"><b>{date(title.due_date)}</b></Cell>
          <Cell label="Valor documento" className="span-2 right"><b>{money(title.amount)}</b></Cell>
          <Cell label="(-) Desconto / Abatimentos" className="span-3"/><Cell label="(-) Outras deduções" className="span-3"/><Cell label="(+) Mora / Multa" className="span-2"/><Cell label="(+) Outros acréscimos" className="span-2"/><Cell label="(=) Valor cobrado" className="span-2"/>
          <div className="span-12"><Party label="Pagador" party={payer}/></div>
        </div>
        <div className="boleto-receipt-footer"><span>Demonstrativo {text(print.demonstrative)}</span><span>Autenticação mecânica</span></div>
      </section>

      <div className="boleto-cut"><span>Corte na linha pontilhada</span></div>

      <section className="boleto-compensation">
        <BankHeader bank={bank} title={line}/>
        <div className="boleto-comp-grid">
          <div className="boleto-comp-left">
            <Cell label="Local de pagamento"><b>{text(print.local_payment)}</b></Cell>
            <Cell label="Beneficiário"><b>{text(beneficiary.name)}</b>{beneficiary.document?` (${document(beneficiary.document)})`:''}<br/><span>{address(beneficiary)}</span></Cell>
            <div className="boleto-row row-5"><Cell label="Data do documento">{date(title.document_date)}</Cell><Cell label="Número do documento"><b>{text(title.document_number)}</b></Cell><Cell label="Espécie doc.">{text(title.species_label)}</Cell><Cell label="Aceite">{text(title.acceptance)}</Cell><Cell label="Data processamento">{date(title.processing_date)}</Cell></div>
            <div className="boleto-row row-5"><Cell label="Uso do banco"/><Cell label="Carteira"><b>{text(title.wallet)}</b></Cell><Cell label="Espécie moeda">{text(title.currency)||'R$'}</Cell><Cell label="Quantidade"/><Cell label="Valor"/></div>
            <div className="boleto-instructions"><small>Instruções (Instruções de responsabilidade do beneficiário. Qualquer dúvida sobre este boleto, contate o beneficiário)</small>{instructions.length?instructions.map((v,i)=><b key={i}>{v}</b>):<span> </span>}</div>
            <Party label="Pagador" party={payer}/>
            <div className="boleto-guarantor"><small>Sacador / Avalista</small><span> </span></div>
          </div>
          <aside className="boleto-comp-right">
            <Cell label="Vencimento" className="right"><b>{date(title.due_date)}</b></Cell>
            <Cell label="Agência / Código beneficiário" className="right"><b>{text(beneficiary.code_display)}</b></Cell>
            <Cell label="Nosso número" className="right"><b>{text(title.our_number_display)}</b></Cell>
            <Cell label="(=) Valor documento" className="right"><b>{money(title.amount)}</b></Cell>
            <Cell label="(-) Desconto / Abatimentos"/><Cell label="(-) Outras deduções"/><Cell label="(+) Mora / Multa"/><Cell label="(+) Outros acréscimos"/><Cell label="(=) Valor cobrado"/>
          </aside>
        </div>
        <div className="boleto-comp-bottom"><div><Barcode value={text(title.barcode)}/></div><div><b>Ficha de Compensação</b><span>Autenticação mecânica</span></div></div>
      </section>
      <div className="boleto-cut bottom"><span>Corte na linha pontilhada</span></div>
    </section>
  </main>;
}
