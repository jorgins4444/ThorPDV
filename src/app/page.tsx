import Link from 'next/link';

const plans = [
  { key: 'basic', name: 'Básico', price: '99,90', highlight: false, features: ['ThorGestão completo', '1 ThorPDV', '3 usuários', 'Controle de estoque', 'NF-e e NFC-e'] },
  { key: 'intermediate', name: 'Intermediário', price: '149,90', highlight: true, features: ['ThorGestão completo', '2 ThorPDVs', '5 usuários', 'Boletos bancários', 'Controle de estoque', 'NF-e e NFC-e'] },
  { key: 'advanced', name: 'Avançado', price: '199,90', highlight: false, features: ['ThorGestão completo', 'Até 5 ThorPDVs', '10 usuários', 'Boletos bancários', 'Controle de estoque', 'NF-e e NFC-e'] },
];

export default function Home() {
  return <main className="public-home">
    <header className="public-header"><div className="brand">ϟ THOR<span>GESTÃO</span></div><nav><a href="#recursos">Recursos</a><a href="#planos">Planos</a><Link className="button secondary" href="/login">Entrar</Link></nav></header>
    <section className="public-hero"><div><span className="public-kicker">ERP + PDV + FISCAL EM UMA SÓ PLATAFORMA</span><h1>Gestão forte para sua empresa vender sem parar.</h1><p>Controle estoque, vendas, financeiro e documentos fiscais com o ThorGestão e o ThorPDV trabalhando juntos.</p><div className="public-actions"><Link className="button" href="/comece-agora">Começar agora</Link><a href="#planos">Conhecer os planos</a></div></div><div className="public-hero-card"><span>ECOSSISTEMA THOR</span><strong>Gestão online + PDV Desktop</strong><ul><li>Operação integrada em tempo real</li><li>Venda mesmo durante instabilidades</li><li>NF-e e NFC-e centralizadas</li><li>Controle de estoque completo</li></ul></div></section>
    <section id="recursos" className="public-benefits"><article><b>01</b><h2>Venda integrada</h2><p>PDVs conectados ao estoque, financeiro e fiscal.</p></article><article><b>02</b><h2>Controle completo</h2><p>Informações claras para acompanhar toda a empresa.</p></article><article><b>03</b><h2>Fiscal organizado</h2><p>NF-e e NFC-e acompanhadas pelo ThorGestão.</p></article></section>
    <section id="planos" className="public-plans"><div className="public-section-title"><span>PLANOS MENSAIS</span><h2>Escolha a força ideal para sua operação</h2><p>Todos os planos incluem controle de estoque e emissão de NF-e/NFC-e.</p></div><div className="public-plan-grid">{plans.map(plan=><article key={plan.key} className={plan.highlight?'featured':''}>{plan.highlight&&<em>MAIS ESCOLHIDO</em>}<h3>{plan.name}</h3><div className="public-price"><small>R$</small><strong>{plan.price}</strong><span>/mês</span></div><ul>{plan.features.map(item=><li key={item}>✓ {item}</li>)}</ul><Link className="button" href={`/comece-agora?plano=${plan.key}`}>Quero este plano</Link></article>)}</div></section>
    <section className="public-cta"><div><span>PRONTO PARA COMEÇAR?</span><h2>Leve o Thor para sua empresa.</h2><p>Preencha seus dados e fale diretamente com nosso atendimento pelo WhatsApp.</p></div><Link className="button" href="/comece-agora">Começar agora</Link></section>
    <footer><div className="brand">ϟ THOR<span>GESTÃO</span></div><p>Gestão, PDV, estoque e fiscal para o varejo brasileiro.</p></footer>
  </main>;
}
