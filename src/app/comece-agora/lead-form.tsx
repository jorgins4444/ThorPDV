'use client';

import { FormEvent, useState, useTransition } from 'react';
import { submitLead } from './actions';

const plans = {
  basic: { name: 'Básico', price: 'R$ 99,90', detail: 'ThorGestão, 1 PDV e 3 usuários' },
  intermediate: { name: 'Intermediário', price: 'R$ 149,90', detail: 'ThorGestão, 2 PDVs, 5 usuários e boletos' },
  advanced: { name: 'Avançado', price: 'R$ 199,90', detail: 'ThorGestão, até 5 PDVs, 10 usuários e boletos' },
} as const;

export function LeadForm({ initialPlan = 'basic' }: { initialPlan?: keyof typeof plans }) {
  const [plan, setPlan] = useState<keyof typeof plans>(initialPlan);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await submitLead({
        companyName: String(form.get('companyName') || ''),
        cnpj: String(form.get('cnpj') || ''),
        ownerName: String(form.get('ownerName') || ''),
        phone: String(form.get('phone') || ''),
        businessNiche: String(form.get('businessNiche') || ''),
        email: String(form.get('email') || ''),
        website: String(form.get('website') || ''),
        plan,
      });
      if (!result.ok || !result.whatsappUrl) {
        setError(result.error || 'Não foi possível continuar.');
        return;
      }
      window.location.assign(result.whatsappUrl);
    });
  }

  return <form className="lead-form" onSubmit={submit}>
    <div className="lead-form-heading">
      <span>COMECE AGORA</span>
      <h1>Conte um pouco sobre sua empresa</h1>
      <p>Seus dados serão registrados no nosso atendimento e você continuará a conversa pelo WhatsApp.</p>
    </div>
    <div className="lead-plan-picker">
      {(Object.entries(plans) as [keyof typeof plans, typeof plans[keyof typeof plans]][]).map(([key, item]) =>
        <button type="button" key={key} className={plan === key ? 'selected' : ''} onClick={() => setPlan(key)}>
          <strong>{item.name}</strong><b>{item.price}<small>/mês</small></b><span>{item.detail}</span>
        </button>)}
    </div>
    <div className="lead-fields">
      <label>Empresa<input name="companyName" required minLength={2} maxLength={160} placeholder="Nome da empresa" /></label>
      <label>CNPJ<input name="cnpj" required inputMode="numeric" minLength={14} maxLength={18} placeholder="00.000.000/0000-00" /></label>
      <label>Nome do proprietário<input name="ownerName" required minLength={2} maxLength={120} placeholder="Responsável pela empresa" /></label>
      <label>Telefone / WhatsApp<input name="phone" required inputMode="tel" minLength={10} maxLength={16} placeholder="(86) 99999-9999" /></label>
      <label>Nicho<select name="businessNiche" required defaultValue=""><option value="" disabled>Selecione</option><option>Varejo</option><option>Supermercado e mercearia</option><option>Moda e calçados</option><option>Restaurante e alimentação</option><option>Farmácia</option><option>Material de construção</option><option>Autopeças</option><option>Serviços</option><option>Outro</option></select></label>
      <label>E-mail<input name="email" required type="email" maxLength={180} placeholder="contato@empresa.com.br" /></label>
      <label className="lead-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
    </div>
    {error ? <p className="lead-error">{error}</p> : null}
    <button className="lead-submit" disabled={pending}>{pending ? 'Registrando seu interesse...' : 'Continuar pelo WhatsApp'}</button>
    <small className="lead-privacy">Ao continuar, você autoriza o contato comercial do ThorGestão sobre o plano escolhido.</small>
  </form>;
}
