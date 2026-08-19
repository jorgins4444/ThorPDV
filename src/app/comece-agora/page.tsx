import Link from 'next/link';
import { LeadForm } from './lead-form';
import './lead.css';

export default async function ComeceAgoraPage({ searchParams }: { searchParams: Promise<{ plano?: string }> }) {
  const selected = (await searchParams).plano;
  const initialPlan = selected === 'intermediate' || selected === 'advanced' ? selected : 'basic';
  return <main className="lead-page">
    <header><Link className="lead-brand" href="/">ϟ THOR<span>GESTÃO</span></Link><Link href="/login">Já sou cliente</Link></header>
    <section className="lead-layout">
      <aside>
        <span className="lead-kicker">IMPLANTAÇÃO ACOMPANHADA</span>
        <h2>Uma gestão mais forte começa com os dados certos.</h2>
        <p>Nossa equipe recebe sua solicitação no ThorControl e continua o atendimento pelo WhatsApp.</p>
        <ul><li>Controle completo de estoque</li><li>Emissão de NF-e e NFC-e</li><li>ThorPDV integrado ao ThorGestão</li><li>Atendimento para escolher o plano ideal</li></ul>
      </aside>
      <LeadForm initialPlan={initialPlan} />
    </section>
  </main>;
}
